import { Buffer } from 'node:buffer'
import { and, eq, isNotNull, isNull, ne, or } from 'drizzle-orm'
import { getDb } from '#/db'
import { mensagens } from '#/db/schema'
import { getAuth } from './auth'
import { limitarUsuario } from './rate-limit'
import { isCrossSiteRequest } from './same-origin'
import { enforceAccess } from './session-access'
import {
  ArquivoEnvioInvalido,
  MAX_BYTES_ENVIO,
  validarArquivoEnvio,
} from './wa-arquivo-envio'
import { destinoDaConversa, transmitirMensagem } from './wa-conversas-envio'
import { chaveArquivoWhatsApp, gravarArquivoWhatsApp } from './wa-midia'

const resposta = (dados: object, status = 200) =>
  Response.json(dados, {
    status,
    headers: { 'cache-control': 'private, no-store' },
  })
const erro = (erro: string, status: number) => resposta({ erro }, status)

function campo(request: Request, nome: string, max: number) {
  const valor = request.headers.get(nome)
  try {
    const texto = decodeURIComponent(valor ?? '').trim()
    if (texto.length <= max && !/[\p{Cc}]/u.test(texto)) return texto
  } catch {
    /* Cabeçalho inválido. */
  }
  throw new ArquivoEnvioInvalido(400, 'Confira o nome do arquivo e a legenda.')
}

// O limite vale também para pedidos sem Content-Length. Interrompe a leitura
// assim que o corpo excede o teto, antes de reservar espaço no banco ou no R2.
async function lerArquivo(request: Request) {
  const tamanho = Number(request.headers.get('content-length'))
  const grande = () =>
    new ArquivoEnvioInvalido(
      413,
      'O arquivo pode ter até 8 MiB. Fotos e áudios podem ter até 4 MiB.',
    )
  if (tamanho > MAX_BYTES_ENVIO) throw grande()
  const leitor = request.body?.getReader()
  if (!leitor) throw new ArquivoEnvioInvalido(400, 'O arquivo está vazio.')
  const partes: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await leitor.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BYTES_ENVIO) {
        await leitor.cancel()
        throw grande()
      }
      partes.push(value)
    }
  } finally {
    leitor.releaseLock()
  }
  const bytes = Buffer.concat(partes, total)
  const formato = validarArquivoEnvio(bytes)
  const nome = campo(request, 'x-arquivo-nome', 180)
  const legenda = campo(request, 'x-legenda', 1024)
  const duracao = Number(request.headers.get('x-duracao'))
  if (
    !nome ||
    /[/\\]/.test(nome) ||
    !Number.isSafeInteger(duracao) ||
    duracao < 0 ||
    duracao > 86400
  )
    throw new ArquivoEnvioInvalido(
      400,
      'Confira o nome e a duração do arquivo.',
    )
  return {
    bytes,
    ...formato,
    nome,
    legenda: formato.tipo === 'foto' ? legenda : null,
    duracao: formato.tipo === 'audio' ? duracao : null,
  }
}

// O workerd representa também um POST de zero bytes por um stream.
async function temCorpo(request: Request) {
  const tamanho = request.headers.get('content-length')
  if (tamanho !== null) return tamanho !== '0'
  const leitor = request.body?.getReader()
  if (!leitor) return false
  try {
    for (;;) {
      const { done, value } = await leitor.read()
      if (done) return false
      if (value.byteLength) {
        await leitor.cancel()
        return true
      }
    }
  } finally {
    leitor.releaseLock()
  }
}

export async function receberEnvioMidia(
  env: Env,
  request: Request,
  conversaId: string,
  id: string,
) {
  if (isCrossSiteRequest(request))
    return erro('Pedido de outro site recusado.', 403)
  const sessao = await enforceAccess(
    env,
    await getAuth(env, request).api.getSession({
      headers: request.headers,
      query: { disableCookieCache: true },
    }),
  )
  if (!sessao) return erro('Entre na sua conta.', 401)
  try {
    await limitarUsuario(sessao.user.id, 'escrita')
  } catch {
    return erro('Muitas requisições. Tente de novo em um minuto.', 429)
  }
  if (
    !/^[\w-]{1,180}$/.test(conversaId) ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)
  )
    return erro('Identificador da mensagem inválido.', 400)
  try {
    const db = getDb(env.DB)
    const alvo = await destinoDaConversa(db, sessao.user.id, conversaId)
    const upload = request.headers.has('x-arquivo-nome')
    if (!upload && (await temCorpo(request)))
      return erro('Informe o nome do arquivo.', 400)
    const arquivo = upload ? await lerArquivo(request) : null
    const condicao = and(
      eq(mensagens.id, id),
      eq(mensagens.conversaId, conversaId),
      eq(mensagens.numeroId, alvo.numeroId),
      eq(mensagens.direcao, 'enviada'),
      ne(mensagens.tipo, 'texto'),
      isNotNull(mensagens.arquivoChave),
      or(isNotNull(mensagens.tentativaEm), isNull(mensagens.identificador)),
    )
    // A reserva põe a chave na cascata de exclusão antes de gravar no R2.
    // O tamanho -1 indica um put pendente. Até lá, a reserva fica oculta
    // e um pedido interrompido pode ser completado com o mesmo identificador.
    const projecao = {
      chave: mensagens.arquivoChave,
      mime: mensagens.arquivoMime,
      nome: mensagens.arquivoNome,
      texto: mensagens.texto,
      bytes: mensagens.arquivoBytes,
    }
    const [reserva] = arquivo
      ? await db
          .insert(mensagens)
          .values({
            id,
            conversaId,
            numeroId: alvo.numeroId,
            tipo: arquivo.tipo,
            direcao: 'enviada',
            estado: 'fila',
            instante: new Date(),
            arquivoChave: chaveArquivoWhatsApp(
              alvo.numeroId,
              crypto.randomUUID(),
            ),
            arquivoMime: arquivo.mime,
            arquivoBytes: -1,
            arquivoNome: arquivo.nome,
            texto: arquivo.legenda,
            duracaoSegundos: arquivo.duracao,
          })
          .onConflictDoNothing()
          .returning(projecao)
      : []
    const salva =
      reserva ??
      (await db.select(projecao).from(mensagens).where(condicao).get())
    if (!salva?.chave)
      return erro('Arquivo ainda não recebido nesta conversa.', 404)
    if (
      arquivo &&
      (arquivo.mime !== salva.mime ||
        arquivo.nome !== salva.nome ||
        arquivo.legenda !== salva.texto)
    )
      return erro('Este identificador já pertence a outro arquivo.', 409)
    const chave = salva.chave
    const agora = new Date()
    let nova = false
    if (salva.bytes === -1) {
      let objeto = reserva ? null : await env.BUCKET.head(chave)
      if (!objeto && arquivo) {
        objeto =
          (await gravarArquivoWhatsApp(
            env.BUCKET,
            chave,
            arquivo.bytes,
            arquivo.mime,
            { etagDoesNotMatch: '*' },
          )) ?? (await env.BUCKET.head(chave))
      }
      if (!objeto)
        return erro('Arquivo ainda não recebido nesta conversa.', 404)
      const [pronta] = await db
        .update(mensagens)
        .set({ arquivoBytes: objeto.size, tentativaEm: agora })
        .where(
          and(
            condicao,
            eq(mensagens.arquivoChave, chave),
            eq(mensagens.arquivoBytes, -1),
          ),
        )
        .returning({ id: mensagens.id })
      nova = !!pronta
      if (
        !pronta &&
        !(await db
          .select({ id: mensagens.id })
          .from(mensagens)
          .where(and(condicao, eq(mensagens.arquivoChave, chave)))
          .get())
      ) {
        // O contato foi apagado enquanto o put ainda estava em trânsito.
        await env.BUCKET.delete(chave)
        return erro('A conversa já foi apagada.', 404)
      }
    }
    let recusa: Response | undefined
    const estado = await transmitirMensagem(db, env, alvo, {
      mesmaMensagem: and(condicao, eq(mensagens.arquivoChave, chave)),
      id,
      agora,
      nova,
      repetir: !upload,
      requisicao: async () => {
        const objeto = await env.BUCKET.get(chave)
        if (!objeto) throw new Error('Arquivo indisponível.')
        const bytes = Buffer.from(await objeto.arrayBuffer())
        const formato = validarArquivoEnvio(bytes)
        if (!(await enforceAccess(env, sessao))) {
          recusa = erro('Entre na sua conta.', 401)
          throw new Error('Sessão expirada.')
        }
        try {
          const atual = await destinoDaConversa(
            getDb(env.DB, 'primario'),
            sessao.user.id,
            conversaId,
          )
          if (
            atual.numeroId !== alvo.numeroId ||
            atual.setorId !== alvo.setorId ||
            atual.token !== alvo.token ||
            atual.destino !== alvo.destino
          )
            throw new Error('O destino mudou.')
        } catch (e) {
          recusa = erro(
            'Não foi possível autorizar o envio nesta conversa.',
            403,
          )
          throw e
        }
        return {
          caminho: '/send/media',
          corpo: {
            file: bytes.toString('base64'),
            type: formato.tipoUazapi,
            mimetype: formato.mime,
            ...(salva.texto ? { text: salva.texto } : {}),
            ...(formato.tipoUazapi === 'document'
              ? { docName: salva.nome }
              : {}),
          },
        }
      },
    })
    return recusa ?? resposta({ estado })
  } catch (e) {
    if (e instanceof ArquivoEnvioInvalido) return erro(e.message, e.status)
    if (e instanceof Error && e.message === 'Sem acesso a esta conversa.')
      return erro(e.message, 403)
    console.error('[whatsapp] Falha ao gravar o envio de mídia.')
    return erro('Não foi possível confirmar o envio. Tente de novo.', 503)
  }
}
