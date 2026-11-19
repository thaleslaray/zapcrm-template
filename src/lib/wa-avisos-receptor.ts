import { and, asc, eq, lt, sql } from 'drizzle-orm'
import { getDb } from '#/db'
import { avisosPendentes, numeros, recibosPendentes } from '#/db/schema'
import { agendarAvisoSetor } from './avisar-setor'
import { isRateLimited } from './rate-limit'
import {
  autenticarAviso,
  type CredencialInstancia,
  conferirEndereco,
  decifrarToken,
  objeto,
  segredoConfere,
} from './uazapi'
import { cargaPendente, executarAviso } from './wa-avisos'
import { type Aviso, lerAviso } from './wa-avisos-formato'
import { lotesWa } from './wa-lotes'

import { obterServidor } from './wa-servidor'

type Tarefa = { id: string; numeroId: string; conteudo: string }

async function consumir(
  env: Env,
  credencial: CredencialInstancia,
  setorId: string,
  t: Tarefa,
  varrerAgora = true,
) {
  const aviso: Aviso = JSON.parse(t.conteudo)
  await executarAviso(env, t.numeroId, credencial, aviso, varrerAgora)
  const apagar = env.DB.prepare('DELETE FROM avisos_pendentes WHERE id=?').bind(
    t.id,
  )
  if (
    (aviso.tipo === 'mensagens' && aviso.historico) ||
    aviso.tipo === 'chats'
  ) {
    // O complete pode ter chegado enquanto o R2 ainda guardava uma foto.
    // Retira o indicador na mesma transação que confirma a última cópia.
    await env.DB.batch([
      apagar,
      env.DB.prepare(`UPDATE numeros SET sincronizando_historico=0
      WHERE id=? AND historico_ordem<0 AND NOT ${cargaPendente}`).bind(
        t.numeroId,
      ),
    ])
  } else await apagar.run()
  agendarAvisoSetor(setorId)
}

// Aceita corpo fragmentado e impõe o limite também sem Content-Length.
async function lerCorpo(request: Request) {
  const leitor = request.body?.getReader()
  if (!leitor) return null
  const limite = 16 * 1024 * 1024
  let tamanho = 0
  const texto = new TextDecoder()
  const partes: string[] = []
  try {
    for (;;) {
      const { value, done } = await leitor.read()
      if (done) break
      tamanho += value.byteLength
      if (tamanho > limite) {
        await leitor.cancel()
        return null
      }
      partes.push(texto.decode(value, { stream: true }))
    }
    partes.push(texto.decode())
    return objeto(JSON.parse(partes.join('')))
  } catch {
    return null
  } finally {
    leitor.releaseLock()
  }
}

function lotes(avisos: Aviso[]) {
  const lotes: Aviso[] = []
  for (const a of avisos) {
    if (a.tipo === 'mensagens') {
      for (const mensagens of lotesWa(a.mensagens))
        lotes.push({ ...a, mensagens })
    } else if (a.tipo === 'recibo') {
      for (let i = 0; i < a.ids.length; i += 100)
        lotes.push({ ...a, ids: a.ids.slice(i, i + 100) })
    } else lotes.push(a)
  }
  return lotes
}

const resposta = (status: number) =>
  new Response(null, { status, headers: { 'cache-control': 'no-store' } })

export async function receberWebhook(
  env: Env,
  request: Request,
  aguardar: (p: Promise<unknown>) => void,
) {
  if (request.method !== 'POST') return resposta(405)
  const caminho =
    /^\/api\/whatsapp\/aviso\/([\w-]{1,128})\/([\w.-]{1,128})$/.exec(
      new URL(request.url).pathname,
    )
  if (!caminho) return resposta(403)
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    return resposta(415)
  if (Number(request.headers.get('content-length')) > 16 * 1024 * 1024)
    return resposta(413)
  const [, numero, segredo] = caminho
  const assinado = await conferirEndereco(env.UAZAPI_CHAVE, numero, segredo)
  if (!assinado) {
    if (await isRateLimited('aviso-whatsapp', { headers: request.headers }))
      return resposta(429)
    // URLs antigas guardavam apenas o resumo no número. Permanecem válidas
    // até o próximo pareamento, com a consulta limitada antes de chegar ao D1.
    if (!/^[\w-]{43}$/.test(segredo)) return resposta(403)
  }
  const db = getDb(env.DB)
  const [n] = await db
    .select({
      setorId: numeros.setorId,
      segredoWebhookHash: numeros.segredoWebhookHash,
      tokenCifrado: numeros.tokenCifrado,
      servidorOrigem: numeros.servidorOrigem,
    })
    .from(numeros)
    .where(eq(numeros.id, numero))
  if (
    !n?.tokenCifrado ||
    !(await segredoConfere(segredo, n.segredoWebhookHash))
  )
    return resposta(403)
  const dados = await lerCorpo(request)
  if (!dados) return resposta(400)
  const token = dados.token
  if (
    typeof token !== 'string' ||
    token.length > 1024 ||
    !(await autenticarAviso(env.UAZAPI_CHAVE, n, segredo, token))
  )
    return resposta(403)
  // A caixa de entrada guarda a projeção de campos permitidos, nunca o
  // envelope bruto, que contém o token da instância e o endereço do servidor.
  const servidor = await obterServidor(db, env)
  if ((n.servidorOrigem ?? servidor.origemLegada) !== servidor.endereco)
    return resposta(403)
  const credencial = {
    endereco: servidor.endereco,
    token,
    vinculo: n.tokenCifrado,
  }
  const avisos = lotes(lerAviso(dados))
  const tarefas = avisos.map((a) => ({
    id: crypto.randomUUID(),
    numeroId: numero,
    conteudo: JSON.stringify(a),
  }))
  if (tarefas.length) {
    // O corpo pode ter chegado antes de uma troca de servidor. A mesma
    // credencial precisa continuar vinculada no momento de enfileirar.
    const vinculo = and(
      eq(numeros.id, numero),
      eq(numeros.tokenCifrado, n.tokenCifrado),
    )
    const inserir = tarefas.map((t) =>
      db
        .insert(avisosPendentes)
        .select(
          sql`SELECT ${t.id}, ${numero}, ${t.conteudo}, ${Date.now()} FROM numeros WHERE ${vinculo}`,
        ),
    )
    const [primeira, ...outras] = inserir
    const dadosHistoricos = avisos.find(
      (a) => a.tipo === 'chats' || (a.tipo === 'mensagens' && a.historico),
    )
    const pedido =
      dadosHistoricos && 'pedido' in dadosHistoricos
        ? dadosHistoricos.pedido
        : null
    const sincronizar = db
      .update(numeros)
      .set({ sincronizandoHistorico: true })
      .where(and(vinculo, eq(numeros.historicoPedido, pedido ?? '')))
    const [salvo] = await db.batch([
      primeira,
      ...outras,
      ...(pedido ? [sincronizar] : []),
    ])
    if (!salvo.meta.changes) return resposta(403)
    if (pedido) agendarAvisoSetor(n.setorId)
    aguardar(
      (async () => {
        try {
          for (const t of tarefas) await consumir(env, credencial, n.setorId, t)
        } catch {
          console.error('[whatsapp] Aviso pendente de reprocessamento.')
        }
      })(),
    )
  }
  return resposta(200)
}

export async function retomarAvisos(env: Env) {
  const db = getDb(env.DB)
  // O identificador de recibo sem mensagem só é conciliável enquanto o
  // transporte ainda consegue devolver a mensagem (até sete dias).
  await db
    .delete(recibosPendentes)
    .where(lt(recibosPendentes.criadoEm, new Date(Date.now() - 7 * 86400000)))
  const pendentes = await db
    .select({
      id: avisosPendentes.id,
      numeroId: avisosPendentes.numeroId,
      conteudo: avisosPendentes.conteudo,
      setorId: numeros.setorId,
      tokenCifrado: numeros.tokenCifrado,
      servidorOrigem: numeros.servidorOrigem,
    })
    .from(avisosPendentes)
    .innerJoin(numeros, eq(numeros.id, avisosPendentes.numeroId))
    .orderBy(asc(avisosPendentes.criadoEm))
    .limit(20)
  if (!pendentes.some((t) => t.tokenCifrado)) return
  const servidor = await obterServidor(db, env)
  for (const t of pendentes) {
    if (
      !t.tokenCifrado ||
      (t.servidorOrigem ?? servidor.origemLegada) !== servidor.endereco
    )
      continue
    try {
      await consumir(
        env,
        {
          endereco: servidor.endereco,
          token: await decifrarToken(env.UAZAPI_CHAVE, t.tokenCifrado),
          vinculo: t.tokenCifrado,
        },
        t.setorId,
        t,
        // O cron da varredura reserva outro orçamento de D1 e de rede.
        false,
      )
    } catch {
      // Um arquivo temporariamente indisponível não bloqueia outros números.
      await db
        .update(avisosPendentes)
        .set({ criadoEm: new Date() })
        .where(eq(avisosPendentes.id, t.id))
      console.error('[whatsapp] Aviso ainda pendente.')
    }
  }
}
