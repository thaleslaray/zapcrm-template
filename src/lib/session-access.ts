import { eq } from 'drizzle-orm'

import { session as sessionTable } from '#/db/auth-schema'
import { getDb } from '#/db/index'
import { consultarAcesso } from '#/lib/acesso-email'

/** Devolve a sessão se o e-mail dela ainda tem acesso; senão `null` e as sessões dele são apagadas. */
export async function enforceAccess<
  T extends {
    session: { id: string }
    user: { id: string; email: string }
  } | null,
>(env: Env, current: T): Promise<T | null> {
  if (!current) return current
  const acesso = await consultarAcesso(
    env,
    current.user.email,
    current.session.id,
  )
  if (acesso.permitido) return acesso.sessaoValida ? current : null
  try {
    await getDb(env.DB)
      .delete(sessionTable)
      .where(eq(sessionTable.userId, current.user.id))
  } catch (error) {
    // Recusar já protege; a limpeza é reforço.
    console.error(
      '[auth] não consegui apagar as sessões de quem saiu da lista',
      error,
    )
  }
  return null
}
