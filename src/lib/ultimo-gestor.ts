import { env } from 'cloudflare:workers'
import type { getDb } from '#/db'
import { hasAccess } from './allowlist'

// O segredo inteiro nunca entra nos parâmetros SQL. A lista só informa quais
// gestoras candidatas podem entrar pela configuração desta instalação.
export async function garantirSubstituto(
  db: ReturnType<typeof getDb>,
  pessoa: string,
) {
  const banco = db.$client
  const { results } = await banco
    .prepare(
      "SELECT u.email FROM user u JOIN pessoas p ON p.usuario_id=u.id WHERE p.papel='gestor' AND u.deleted_at IS NULL",
    )
    .all<{ email: string }>()
  const liberados = results
    .map((r) => r.email)
    .filter((email) => hasAccess(email, env.ACCESS_ALLOWLIST))
  return banco
    .prepare(
      'INSERT INTO conferir_substituto_gestor (pessoa,emails_liberados) VALUES (?,?)',
    )
    .bind(pessoa, JSON.stringify(liberados))
}

export const mensagemUltimoGestor =
  'A equipe precisa de pelo menos um gestor. Promova outra pessoa antes de continuar.'

export function conferirUltimoGestor(erro: unknown): never {
  let causa = erro
  while (causa instanceof Error) {
    if (causa.message.includes('ULTIMO_GESTOR'))
      throw new Error(mensagemUltimoGestor)
    causa = causa.cause
  }
  throw erro
}
