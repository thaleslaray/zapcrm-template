import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import { getDb } from '#/db'
import { session, user } from '#/db/auth-schema'
import { acessosRevogados, convites, setores } from '#/db/schema'
import { idsDeSetoresVisiveis, setoresVisiveis } from './acesso-crm'
import { hasAccess } from './allowlist'
import { getAuth } from './auth'
import { isUserRateLimited, tooManyRequests } from './rate-limit'
import { enforceAccess } from './session-access'

export async function conectarSetor(env: Env, request: Request, setor: string) {
  const recusar = (status: number) =>
    new Response(null, { status, headers: { 'cache-control': 'no-store' } })
  if (request.method !== 'GET') return recusar(405)
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
    return recusar(426)
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return recusar(403)
  const atual = await getAuth(env, request).api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true, disableRefresh: true },
  })
  if (!atual) return recusar(401)
  if (await isUserRateLimited(atual.user.id, 'leitura'))
    return tooManyRequests()
  const [sessao, acesso] = await Promise.allSettled([
    enforceAccess(env, atual),
    setoresVisiveis(getDb(env.DB), atual.user.id),
  ])
  if (sessao.status === 'rejected' || acesso.status === 'rejected')
    return recusar(403)
  if (!sessao.value) return recusar(401)
  if (!acesso.value.setores.includes(setor)) return recusar(403)
  // Não encaminhar cookie, token, protocolo ou cabeçalhos escolhidos pelo cliente.
  return env.TEMPO_REAL.getByName(setor).fetch('https://setor.internal/', {
    headers: {
      upgrade: 'websocket',
      'x-sessao': atual.session.id,
      'x-usuario': atual.user.id,
    },
  })
}

// A sessão identifica a conexão e a pessoa limita as abas. Uma consulta no
// primário confere todas as sessões do setor, inclusive após revogação ou logout.
export async function sessoesDoSetor(env: Env, setor: string, ids: string[]) {
  const db = getDb(env.DB)
  const linhas = await db
    .select({
      id: session.id,
      email: user.email,
      convite: convites.id,
    })
    .from(session)
    .innerJoin(user, eq(user.id, session.userId))
    .innerJoin(setores, eq(setores.id, setor))
    .leftJoin(convites, eq(convites.email, user.email))
    .leftJoin(acessosRevogados, eq(acessosRevogados.email, user.email))
    .where(
      and(
        inArray(
          session.id,
          sql`(select value from json_each(${JSON.stringify(ids)}))`,
        ),
        gt(session.expiresAt, new Date()),
        isNull(user.deletedAt),
        isNull(acessosRevogados.email),
        inArray(setores.id, idsDeSetoresVisiveis(db, session.userId)),
      ),
    )
  return new Set(
    linhas
      .filter((l) =>
        hasAccess(l.email, env.ACCESS_ALLOWLIST, undefined, {
          convidado: l.convite ? 1 : 0,
          revogado: 0,
        }),
      )
      .map((l) => l.id),
  )
}
