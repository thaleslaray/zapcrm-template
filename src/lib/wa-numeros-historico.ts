import { currentD1Session } from '#/db/d1-session'
import {
  type CredencialInstancia,
  chamarInstancia,
  objeto,
  UazapiErro,
} from './uazapi'
import { consolidarAvisoLocal, gravarHistorico } from './wa-avisos'
import { lerMensagem, type MensagemWa } from './wa-avisos-formato'
import { importarChats } from './wa-chats'

const LIMITE_CHATS = 100
const LIMITE_MENSAGENS = 20

type Cursor = {
  id: string
  chats: number | null
  mensagens: number | null
  conversasSincronizadas: number
  mensagensNovas: number
  buscarFalhas: string[] | null
  falhasSemResultado: string[]
  ordem?: number
  desde?: number
}

function proximoOffset(paginacao: unknown, atual: number) {
  const p = objeto(paginacao)
  if (p.hasMore === false) return null
  if (
    p.hasMore !== true ||
    typeof p.nextOffset !== 'number' ||
    !Number.isSafeInteger(p.nextOffset) ||
    p.nextOffset <= atual
  )
    throw new UazapiErro(502)
  return p.nextOffset
}

async function falhasDoProvedor(c: CredencialInstancia) {
  const ids = new Set<string>()
  try {
    const erros = await chamarInstancia(c.endereco, c.token, '/webhook/errors')
    if (Array.isArray(erros)) {
      for (const erro of erros) {
        const { event, messageid } = objeto(erro)
        if (
          event === 'messages' &&
          typeof messageid === 'string' &&
          messageid.length > 0 &&
          messageid.length <= 255 &&
          ids.size < 100
        )
          ids.add(messageid)
      }
    }
  } catch (e) {
    console.warn(
      `[uazapi] consulta de falhas de webhook indisponível (${e instanceof UazapiErro ? e.status : 'erro'})`,
    )
  }
  return ids
}

// Uma ida ao R2 pode envolver multipart e limpeza. Mesmo quando todos os
// anexos aparecem na mesma página, só um deles entra nesta invocação.
// O teto em bytes mantém cada lote SQL abaixo do limite de gravarHistorico.
function recortar(valores: unknown[]) {
  const aceitas: MensagemWa[] = []
  let itens = 0
  let bytes = 0
  let temMidia = false
  const encoder = new TextEncoder()
  for (const valor of valores) {
    const m = lerMensagem(valor)
    if (m) {
      const tamanho = encoder.encode(JSON.stringify(m)).length
      if (
        aceitas.length &&
        (bytes + tamanho > 512 * 1024 || (m.tipo !== 'texto' && temMidia))
      )
        break
      bytes += tamanho
      temMidia ||= m.tipo !== 'texto'
      aceitas.push(m)
    }
    itens++
  }
  return { itens, aceitas }
}

export async function reconciliarNumero(
  env: Env,
  numeroId: string,
  credencial: CredencialInstancia,
) {
  const db = currentD1Session() ?? env.DB
  const inicial: Cursor = {
    id: crypto.randomUUID(),
    chats: 0,
    mensagens: 0,
    conversasSincronizadas: 0,
    mensagensNovas: 0,
    buscarFalhas: null,
    falhasSemResultado: [],
  }
  const linha = await db
    .prepare(`UPDATE numeros SET reconciliacao_cursor=coalesce(reconciliacao_cursor,?)
      WHERE id=? AND token_cifrado=? RETURNING reconciliacao_cursor, dias_historico`)
    .bind(JSON.stringify(inicial), numeroId, credencial.vinculo)
    .first<{ reconciliacao_cursor: string; dias_historico: number }>()
  if (!linha) throw new Error('O vínculo do número mudou.')
  let anterior: string | null = linha.reconciliacao_cursor
  const cursor: Cursor = JSON.parse(linha.reconciliacao_cursor)
  // A lista traz só as conversas com mensagem dentro dos dias de histórico do
  // número. O corte fica no cursor para valer igual em todas as páginas.
  if (cursor.ordem !== 3 || !cursor.desde) {
    cursor.ordem = 3
    cursor.chats = 0
    cursor.desde = Date.now() - (linha.dias_historico || 90) * 864e5
  }
  async function salvar() {
    const pendente = cursor.chats !== null || cursor.mensagens !== null
    const proximo = pendente ? JSON.stringify(cursor) : null
    const r = await db
      .prepare(`UPDATE numeros SET reconciliacao_cursor=? WHERE id=? AND
        token_cifrado=? AND reconciliacao_cursor=?`)
      .bind(proximo, numeroId, credencial.vinculo, anterior)
      .run()
    if (!r.meta.changes)
      throw new Error('Aguarde a sincronização que está em andamento.')
    anterior = proximo
  }
  if (!cursor.buscarFalhas) {
    cursor.buscarFalhas = [...(await falhasDoProvedor(credencial))]
    await salvar()
  }
  if (cursor.chats !== null) {
    const pagina = objeto(
      await chamarInstancia(
        credencial.endereco,
        credencial.token,
        '/chat/find',
        {
          compact: true,
          // As conversas recentes vêm primeiro. Registros sem mensagem no
          // período (e os antigos, sem nome nem telefone) ficam de fora.
          sort: '-wa_lastMsgTimestamp',
          wa_isGroup: false,
          wa_lastMsgTimestamp: `>${cursor.desde}`,
          limit: LIMITE_CHATS,
          offset: cursor.chats,
        },
      ),
    )
    if (!Array.isArray(pagina.chats) || pagina.chats.length > LIMITE_CHATS)
      throw new UazapiErro(502)
    const proximo = proximoOffset(pagina.pagination, cursor.chats)
    cursor.conversasSincronizadas += await importarChats(
      env,
      numeroId,
      credencial,
      pagina.chats,
    )
    cursor.chats = proximo
    await salvar()
  }
  if (cursor.mensagens !== null) {
    const id = cursor.buscarFalhas[0]
    const corpo = id
      ? { id, limit: 1 }
      : { limit: LIMITE_MENSAGENS, offset: cursor.mensagens }
    let pagina: Record<string, unknown>
    try {
      pagina = objeto(
        await chamarInstancia(
          credencial.endereco,
          credencial.token,
          '/message/find',
          corpo,
        ),
      )
    } catch (e) {
      if (!id || !(e instanceof UazapiErro) || ![400, 404].includes(e.status))
        throw e
      pagina = { messages: [] }
    }
    if (
      !Array.isArray(pagina.messages) ||
      pagina.messages.length > LIMITE_MENSAGENS
    )
      throw new UazapiErro(502)
    const valores = id
      ? pagina.messages
          .filter((m) => objeto(m).id === id || objeto(m).messageid === id)
          .slice(0, 1)
      : pagina.messages
    const proximo = id
      ? cursor.mensagens
      : proximoOffset(pagina.pagination, cursor.mensagens)
    const { itens, aceitas } = recortar(valores)
    cursor.mensagensNovas += await gravarHistorico(
      env,
      numeroId,
      credencial,
      valores.slice(0, itens),
    )
    const reentregas = id
      ? aceitas
      : aceitas.filter(
          (m) =>
            cursor.falhasSemResultado.includes(m.identificador) ||
            cursor.falhasSemResultado.includes(m.idDownload),
        )
    if (reentregas.length) {
      await consolidarAvisoLocal(db, {
        numeroId,
        vinculo: credencial.vinculo,
        conteudo: JSON.stringify({
          tipo: 'mensagens',
          historico: false,
          mensagens: reentregas,
        }),
      })
    }
    if (id) {
      cursor.buscarFalhas.shift()
      if (!aceitas.length) cursor.falhasSemResultado.push(id)
    } else {
      cursor.mensagens =
        itens < valores.length ? cursor.mensagens + itens : proximo
    }
    await salvar()
  }
  return {
    chats: cursor.conversasSincronizadas,
    mensagens: cursor.mensagensNovas,
    pendente: cursor.chats !== null || cursor.mensagens !== null,
  }
}
