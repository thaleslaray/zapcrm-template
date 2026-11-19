import { and, eq, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import { getDb } from '#/db'
import { arquivosEmExclusao, contatos, conversas, numeros } from '#/db/schema'
import { idsDeSetoresVisiveis } from './acesso-crm'
import { getAuth } from './auth'
import { detectImageType } from './avatar'
import { enforceAccess } from './session-access'
import { chamarInstancia, decifrarToken, objeto } from './uazapi'
import { obterServidor } from './wa-servidor'

const MAX_BYTES = 256 * 1024
const DIA = 86_400_000
const ORIGENS_WHATSAPP = ['https://pps.whatsapp.net']
type Banco = ReturnType<typeof getDb>

function indisponivel(status = 404) {
  return new Response(null, {
    status,
    headers: { 'cache-control': 'private, no-store' },
  })
}

async function baixarFoto(endereco: string, origens: readonly string[]) {
  const url = new URL(endereco)
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    !origens.includes(url.origin) ||
    url.username ||
    url.password
  )
    return null
  const oe = url.searchParams.get('oe')
  if (
    oe &&
    /^[a-f\d]{1,12}$/i.test(oe) &&
    Number.parseInt(oe, 16) * 1000 <= Date.now()
  )
    return 'vencida' as const
  const resposta = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
  })
  if (
    !resposta.ok ||
    !resposta.body ||
    Number(resposta.headers.get('content-length')) > MAX_BYTES
  ) {
    await resposta.body?.cancel()
    return [401, 403, 404, 410].includes(resposta.status)
      ? ('vencida' as const)
      : null
  }
  const leitor = resposta.body.getReader()
  const dados = new Uint8Array(MAX_BYTES)
  let usados = 0
  try {
    for (;;) {
      const { done, value } = await leitor.read()
      if (done) break
      if (usados + value.length > MAX_BYTES) {
        await leitor.cancel()
        return null
      }
      dados.set(value, usados)
      usados += value.length
    }
  } finally {
    leitor.releaseLock()
  }
  const bytes = dados.subarray(0, usados)
  const mime = detectImageType(bytes)
  return mime ? { bytes, mime } : null
}

async function renovarFoto(env: Env, db: Banco, id: string, usuario: string) {
  const servidor = await obterServidor(db, env)
  const destino = sql<
    string | null
  >`coalesce(${conversas.jid}, ${conversas.lid}, ${contatos.telefoneNormalizado})`
  const alvo = await db
    .select({ destino, token: numeros.tokenCifrado })
    .from(conversas)
    .innerJoin(contatos, eq(contatos.id, conversas.contatoId))
    .innerJoin(numeros, eq(numeros.id, conversas.numeroId))
    .where(
      and(
        eq(contatos.id, id),
        inArray(numeros.setorId, idsDeSetoresVisiveis(db, usuario)),
        isNotNull(destino),
        isNotNull(numeros.tokenCifrado),
        isNotNull(numeros.estadoEm),
        sql`coalesce(${numeros.servidorOrigem}, ${servidor.origemLegada}) = ${servidor.endereco}`,
      ),
    )
    .get()
  if (!alvo?.destino || !alvo.token) return null
  const agora = new Date()
  const reserva = await db
    .update(contatos)
    .set({ fotoTentativaEm: agora })
    .where(
      and(
        eq(contatos.id, id),
        isNull(contatos.fotoChave),
        or(
          isNull(contatos.fotoTentativaEm),
          lte(contatos.fotoTentativaEm, new Date(+agora - DIA)),
        ),
      ),
    )
    .returning({ id: contatos.id })
  if (!reserva.length) return null
  const token = await decifrarToken(env.UAZAPI_CHAVE, alvo.token)
  const { url } = objeto(
    await chamarInstancia(servidor.endereco, token, '/chat/avatar', {
      number: alvo.destino,
      preview: true,
    }),
  )
  return typeof url === 'string' && url ? url : null
}

// A reserva cobre interrupções depois do put, inclusive se o contato for apagado
// durante o download. O perdedor de duas cópias concorrentes limpa só sua chave.
async function guardarFoto(
  db: Banco,
  bucket: R2Bucket,
  id: string,
  foto: { bytes: Uint8Array; mime: string },
  endereco: string,
) {
  const chave = `contatos/fotos/${crypto.randomUUID()}`
  await db
    .insert(arquivosEmExclusao)
    .values({ chave, contatoId: id, limparApos: Date.now() + DIA })
  await bucket.put(chave, foto.bytes, {
    httpMetadata: { contentType: foto.mime },
  })
  const banco = db.$client
  const [associacao] = await banco.batch([
    banco
      .prepare(`UPDATE contatos SET foto_chave=?,foto_url=? WHERE id=? AND foto_chave IS NULL
      AND EXISTS (SELECT 1 FROM arquivos_em_exclusao WHERE chave=? AND limpar_apos>?)`)
      .bind(chave, endereco, id, chave, Date.now()),
    banco
      .prepare(`DELETE FROM arquivos_em_exclusao WHERE chave=?
      AND EXISTS (SELECT 1 FROM contatos WHERE id=? AND foto_chave=?)`)
      .bind(chave, id, chave),
  ])
  if (associacao.meta.changes) return chave
  await bucket.delete(chave)
  await db.delete(arquivosEmExclusao).where(eq(arquivosEmExclusao.chave, chave))
  return (
    await db
      .select({ chave: contatos.fotoChave })
      .from(contatos)
      .where(eq(contatos.id, id))
      .get()
  )?.chave
}

export async function servirFotoContato(
  env: Env,
  request: Request,
  id: string,
  origens: readonly string[] = ORIGENS_WHATSAPP,
) {
  const sessao = await enforceAccess(
    env,
    await getAuth(env, request).api.getSession({
      headers: request.headers,
      query: { disableCookieCache: true },
    }),
  )
  if (!sessao) return indisponivel(401)
  const db = getDb(env.DB)
  const acesso = idsDeSetoresVisiveis(db, sessao.user.id)
  const alvo = await db
    .select({
      chave: contatos.fotoChave,
      url: contatos.fotoUrl,
      tentativa: contatos.fotoTentativaEm,
    })
    .from(contatos)
    .innerJoin(conversas, eq(conversas.contatoId, contatos.id))
    .innerJoin(numeros, eq(numeros.id, conversas.numeroId))
    .where(and(eq(contatos.id, id), inArray(numeros.setorId, acesso)))
    .get()
  if (!alvo) return indisponivel()
  let chave = alvo.chave
  if (!chave) {
    let endereco = alvo.url
    let foto = endereco
      ? await baixarFoto(endereco, origens).catch(() => null)
      : ('vencida' as const)
    if (foto === 'vencida') {
      if (alvo.tentativa && +alvo.tentativa > Date.now() - DIA)
        return indisponivel()
      endereco = await renovarFoto(env, db, id, sessao.user.id).catch(
        () => null,
      )
      foto = endereco
        ? await baixarFoto(endereco, origens).catch(() => null)
        : null
    }
    if (!endereco || !foto || foto === 'vencida') return indisponivel()
    chave = (await guardarFoto(db, env.BUCKET, id, foto, endereco)) ?? null
  }
  if (!chave) return indisponivel()
  const etag = request.headers.get('if-none-match')
  const arquivo = await env.BUCKET.get(chave, {
    onlyIf: etag ? new Headers({ 'if-none-match': etag }) : undefined,
  })
  if (!arquivo) return indisponivel()
  const headers = {
    'content-type':
      arquivo.httpMetadata?.contentType ?? 'application/octet-stream',
    'content-security-policy': "default-src 'none'; sandbox",
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, no-cache',
    vary: 'Cookie',
    etag: arquivo.httpEtag,
  }
  return 'body' in arquivo
    ? new Response(arquivo.body, { headers })
    : new Response(null, { status: 304, headers })
}
