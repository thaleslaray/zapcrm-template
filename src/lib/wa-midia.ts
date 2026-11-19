import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getDb } from '#/db'
import { arquivosEmExclusao, conversas, mensagens } from '#/db/schema'
import { setoresVisiveis } from './acesso-crm'
import { getAuth } from './auth'
import { isUserRateLimited, tooManyRequests } from './rate-limit'
import { enforceAccess } from './session-access'
import {
  type CredencialInstancia,
  chamarInstancia,
  objeto,
  UazapiErro,
} from './uazapi'
import { MAX_BYTES_ENVIO } from './wa-arquivo-envio'
import type { MensagemWa } from './wa-avisos-formato'

// Só o link retornado por /message/download, autenticado no servidor, pode
// originar um download. URLs que o remetente colocar em content são ignoradas.
function enderecoArquivo(base: string, valor: unknown) {
  if (typeof valor !== 'string') throw new Error('Arquivo indisponível.')
  const u = new URL(valor, base)
  const mesmoServidor = u.origin === new URL(base).origin
  if (
    u.username ||
    u.password ||
    (!mesmoServidor &&
      (u.protocol !== 'https:' ||
        !/^[a-z\d-]+(?:\.[a-z\d-]+)*\.[a-z]{2,}$/i.test(u.hostname) ||
        /\.(?:local|internal|localhost)$/i.test(u.hostname)))
  )
    throw new Error('Endereço de arquivo inválido.')
  return u
}

function mimeSeguro(valor: unknown) {
  const mime = String(valor ?? '')
    .toLowerCase()
    .split(';')[0]
    .trim()
  return /^(image\/(jpeg|png|webp|gif)|audio\/(mpeg|mp4|ogg|wav|webm|aac)|application\/pdf)$/.test(
    mime,
  )
    ? mime
    : 'application/octet-stream'
}

export const chaveArquivoWhatsApp = (numero: string, id: string) =>
  `whatsapp/${numero}/${id}`

export function gravarArquivoWhatsApp(
  bucket: R2Bucket,
  chave: string,
  dados: Uint8Array | ReadableStream,
  mime: string,
  onlyIf?: R2Conditional,
) {
  return bucket.put(chave, dados, {
    httpMetadata: { contentType: mime },
    onlyIf,
  })
}

class MidiaAcimaDoLimite extends Error {}

async function copiarParaBucket(
  bucket: R2Bucket,
  chave: string,
  res: Response,
  mime: string,
) {
  if (!res.body) throw new Error('Arquivo sem conteúdo.')
  const httpMetadata = { contentType: mime }
  if (Number(res.headers.get('content-length')) > MAX_BYTES_ENVIO) {
    await res.body.cancel()
    throw new MidiaAcimaDoLimite()
  }
  // A contagem vale também para respostas comprimidas, fragmentadas e para
  // provedores que enviam um Content-Length incorreto.
  const leitor = res.body.getReader()
  const bloco = new Uint8Array(5 * 1024 * 1024)
  let usados = 0
  let tamanho = 0
  let envio: R2MultipartUpload | undefined
  const partes: R2UploadedPart[] = []
  try {
    for (;;) {
      const { done, value } = await leitor.read()
      if (done) break
      tamanho += value.byteLength
      if (tamanho > MAX_BYTES_ENVIO) {
        await leitor.cancel()
        throw new MidiaAcimaDoLimite()
      }
      for (let i = 0; i < value.length; ) {
        const n = Math.min(bloco.length - usados, value.length - i)
        bloco.set(value.subarray(i, i + n), usados)
        usados += n
        i += n
        if (usados === bloco.length) {
          envio ??= await bucket.createMultipartUpload(chave, { httpMetadata })
          partes.push(await envio.uploadPart(partes.length + 1, bloco))
          usados = 0
        }
      }
    }
    if (!envio)
      return await gravarArquivoWhatsApp(
        bucket,
        chave,
        bloco.subarray(0, usados),
        mime,
      )
    if (usados)
      partes.push(
        await envio.uploadPart(partes.length + 1, bloco.subarray(0, usados)),
      )
    return await envio.complete(partes)
  } catch (erro) {
    if (envio) await envio.abort()
    if (erro instanceof MidiaAcimaDoLimite) throw erro
    throw new Error('Não foi possível guardar o arquivo.')
  } finally {
    leitor.releaseLock()
  }
}

export async function copiarMidia(
  env: Env,
  numero: string,
  credencial: CredencialInstancia,
  m: MensagemWa,
) {
  const db = getDb(env.DB)
  const [pendente] = await db
    .select({ id: mensagens.id, contatoId: conversas.contatoId })
    .from(mensagens)
    .innerJoin(conversas, eq(conversas.id, mensagens.conversaId))
    .where(
      and(
        eq(mensagens.numeroId, numero),
        eq(mensagens.identificador, m.identificador),
        isNull(mensagens.arquivoChave),
        eq(mensagens.midiaRecusada, false),
      ),
    )
  if (!pendente) return
  const recusar = () =>
    db
      .update(mensagens)
      .set({ midiaRecusada: true })
      .where(and(eq(mensagens.id, pendente.id), isNull(mensagens.arquivoChave)))
  let download: Record<string, unknown>
  try {
    download = objeto(
      await chamarInstancia(
        credencial.endereco,
        credencial.token,
        '/message/download',
        { id: m.idDownload },
      ),
    )
  } catch (erro) {
    if (
      !(erro instanceof UazapiErro) ||
      (erro.status !== 400 && erro.status !== 404)
    )
      throw erro
    await recusar()
    return
  }
  const url = enderecoArquivo(credencial.endereco, download.fileURL)
  const res = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error('Não foi possível obter o arquivo.')
  const mime = mimeSeguro(download.mimetype ?? res.headers.get('content-type'))
  // Cada tentativa tem chave própria. Se o Worker parar após o put, o cron
  // recupera a reserva. Uma cópia concorrente nunca apaga o objeto vencedor.
  const chave = chaveArquivoWhatsApp(numero, crypto.randomUUID())
  const limparApos = Date.now() + 86400000
  await db
    .insert(arquivosEmExclusao)
    .values({ chave, contatoId: pendente.contatoId, limparApos })
  let arquivo: R2Object | null
  try {
    arquivo = await copiarParaBucket(env.BUCKET, chave, res, mime)
  } catch (erro) {
    if (!(erro instanceof MidiaAcimaDoLimite)) throw erro
    await db.batch([
      recusar(),
      db.delete(arquivosEmExclusao).where(eq(arquivosEmExclusao.chave, chave)),
    ])
    return
  }
  if (!arquivo) throw new Error('Não foi possível guardar o arquivo.')
  const banco = db.$client
  const [associacao] = await banco.batch([
    banco
      .prepare(`UPDATE mensagens SET arquivo_chave=?,arquivo_mime=?,arquivo_bytes=?
      WHERE id=? AND arquivo_chave IS NULL AND midia_recusada=0 AND EXISTS
      (SELECT 1 FROM arquivos_em_exclusao WHERE chave=? AND limpar_apos>?)`)
      .bind(chave, mime, arquivo.size, pendente.id, chave, Date.now()),
    banco
      .prepare(`DELETE FROM arquivos_em_exclusao WHERE chave=?
      AND EXISTS (SELECT 1 FROM mensagens WHERE id=? AND arquivo_chave=?)`)
      .bind(chave, pendente.id, chave),
  ])
  if (!associacao.meta.changes) {
    await env.BUCKET.delete(chave)
    await db
      .delete(arquivosEmExclusao)
      .where(eq(arquivosEmExclusao.chave, chave))
  }
}

export async function servirMidia(env: Env, request: Request, id: string) {
  const headers = new Headers({
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  })
  const sessao = await enforceAccess(
    env,
    await getAuth(env, request).api.getSession({
      headers: request.headers,
      query: { disableCookieCache: true },
    }),
  )
  if (!sessao)
    return new Response('Entre na sua conta.', { status: 401, headers })
  if (await isUserRateLimited(sessao.user.id, 'leitura'))
    return tooManyRequests()
  const db = getDb(env.DB)
  const acesso = await setoresVisiveis(db, sessao.user.id)
  // ASVS 8.2.2: o ID do arquivo nunca basta para abrir o objeto.
  const [m] = await db
    .select({
      chave: mensagens.arquivoChave,
      mime: mensagens.arquivoMime,
      nome: mensagens.arquivoNome,
      tipo: mensagens.tipo,
    })
    .from(mensagens)
    .where(
      and(eq(mensagens.id, id), inArray(mensagens.numeroId, acesso.numeros)),
    )
  if (!m?.chave)
    return new Response('Arquivo indisponível.', { status: 404, headers })
  const arquivo = await env.BUCKET.get(m.chave, { range: request.headers })
  if (!arquivo || !('body' in arquivo))
    return new Response('Arquivo indisponível.', { status: 404, headers })
  const mime = mimeSeguro(m.mime)
  const inline =
    (m.tipo === 'foto' && mime.startsWith('image/')) ||
    (m.tipo === 'audio' && mime.startsWith('audio/'))
  headers.set('content-type', mime)
  headers.set('content-security-policy', "default-src 'none'; sandbox")
  const nome = m.nome || (m.tipo === 'documento' ? 'Documento' : m.tipo)
  headers.set(
    'content-disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(new TextDecoder().decode(new TextEncoder().encode(nome))).replaceAll("'", '%27')}`,
  )
  headers.set('accept-ranges', 'bytes')
  if (
    request.headers.has('range') &&
    arquivo.range &&
    'offset' in arquivo.range &&
    arquivo.range.length
  ) {
    const inicio = arquivo.range.offset ?? 0
    headers.set(
      'content-range',
      `bytes ${inicio}-${inicio + arquivo.range.length - 1}/${arquivo.size}`,
    )
    headers.set('content-length', String(arquivo.range.length))
    return new Response(arquivo.body, { headers, status: 206 })
  }
  headers.set('content-length', String(arquivo.size))
  return new Response(arquivo.body, { headers })
}
