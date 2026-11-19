import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { getDb } from '#/db'
import { session } from '#/db/auth-schema'
import { pessoasSetores } from '#/db/schema'
import { createAuthHarness, ORIGIN } from '#/test/auth-harness'
import { medirFila } from '#/test/d1-fila'
import { conectarSetor, sessoesDoSetor } from './tempo-real-acesso'

it('recusa outra origem, cookie revogado e setor alheio antes do upgrade', async () => {
  const h = await createAuthHarness()
  try {
    const gestora = await h.signIn('qa-gerencia@exemplo.test')
    const vendedor = await h.signIn('qa-vendas@exemplo.test')
    const db = getDb(h.db)
    await db
      .insert(pessoasSetores)
      .values({ usuarioId: vendedor.body.user.id, setorId: 'com' })
    const pedido = (cookie: string, origin = ORIGIN) =>
      new Request(`${ORIGIN}/api/tempo-real/pos`, {
        headers: { cookie, origin, upgrade: 'websocket' },
      })
    expect(
      (
        await conectarSetor(
          h.env,
          pedido(gestora.cookie, 'https://outro.example'),
          'pos',
        )
      ).status,
    ).toBe(403)
    expect((await conectarSetor(h.env, pedido(''), 'pos')).status).toBe(401)
    const negado = await medirFila(h.db, () =>
      conectarSetor(h.env, pedido(vendedor.cookie), 'pos'),
    )
    expect(negado.resultado.status).toBe(403)
    expect(negado.filaMax, negado.consultas.join(', ')).toBeLessThanOrEqual(2)
    await db.delete(session).where(eq(session.userId, gestora.body.user.id))
    expect(
      (await conectarSetor(h.env, pedido(gestora.cookie), 'pos')).status,
    ).toBe(401)
  } finally {
    await h.dispose()
  }
})

it('deixa de avisar uma sessão já conectada quando ela perde o setor', async () => {
  const h = await createAuthHarness()
  try {
    const gestora = await h.signIn('qa-g@exemplo.test')
    const vendedor = await h.signIn('qa-v@exemplo.test')
    const db = getDb(h.db)
    await db
      .insert(pessoasSetores)
      .values({ usuarioId: vendedor.body.user.id, setorId: 'com' })
    const ativas = await db
      .select({ id: session.id, usuario: session.userId })
      .from(session)
    const ids = ativas.map((s) => s.id)
    expect(await sessoesDoSetor(h.env, 'com', ids)).toEqual(new Set(ids))
    await db
      .delete(pessoasSetores)
      .where(eq(pessoasSetores.usuarioId, vendedor.body.user.id))
    const leitura = await medirFila(h.db, () =>
      sessoesDoSetor(h.env, 'com', ids),
    )
    expect(leitura.resultado).toEqual(
      new Set(
        ativas
          .filter((s) => s.usuario === gestora.body.user.id)
          .map((s) => s.id),
      ),
    )
    expect(leitura.total).toBe(1)
  } finally {
    await h.dispose()
  }
})
