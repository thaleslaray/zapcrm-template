import { hasAccess, normalizeEmail } from './allowlist'

// O binding sem withSession lê o primário. Uma revogação feita em outro aparelho
// precisa valer mesmo se a réplica do pedido ainda não recebeu aquela escrita.
export async function consultarAcesso(
  env: Env,
  email: unknown,
  sessaoId?: string,
) {
  if (typeof email !== 'string')
    return { permitido: false, sessaoValida: false }
  const estado = await env.DB.prepare(`SELECT
    EXISTS(SELECT 1 FROM convites WHERE email=?1) AS convidado,
    EXISTS(SELECT 1 FROM acessos_revogados WHERE email=?1) AS revogado,
    (?2 IS NULL OR EXISTS(SELECT 1 FROM session s JOIN user u ON u.id=s.user_id
      WHERE s.id=?2 AND s.expires_at>?3 AND u.email=?1 AND u.deleted_at IS NULL)) AS sessaoValida`)
    .bind(normalizeEmail(email), sessaoId ?? null, Date.now())
    .first<{ convidado: number; revogado: number; sessaoValida: number }>()
  return {
    permitido: Boolean(
      estado && hasAccess(email, env.ACCESS_ALLOWLIST, undefined, estado),
    ),
    sessaoValida: Boolean(estado?.sessaoValida),
  }
}

export async function acessoPorEmail(env: Env, email: unknown) {
  return (await consultarAcesso(env, email)).permitido
}
