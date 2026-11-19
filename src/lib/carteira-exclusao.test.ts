import '#/lib/audit-d1'
import { expect, it } from 'vitest'
import { getDb } from '#/db'
import { contatos } from '#/db/schema'
import { createAuthHarness } from '#/test/auth-harness'
import { executarComando } from './carteira-escrita'

it('a exclusão confirmada independe da disponibilidade do registro de auditoria', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const gestor = (await h.signIn('qa-excluir@exemplo.test')).body.user.id
    await db.insert(contatos).values({ id: 'cliente', nome: 'Cliente' })
    await h.db
      .prepare(
        "CREATE TRIGGER auditoria_indisponivel BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'auditoria indisponível'); END",
      )
      .run()
    expect(
      await executarComando(db, h.env.BUCKET, gestor, {
        tipo: 'apagarContato',
        contatoId: 'cliente',
        negocios: 0,
        conversas: 0,
      }),
    ).toMatchObject({ ok: true })
    expect(await db.select().from(contatos)).toHaveLength(0)
  } finally {
    await h.dispose()
  }
})

it('autoriza a exclusão somente para um gestor com acesso ativo no momento da gravação', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const email = 'qa-gestor-revogado@exemplo.test'
    const gestor = (await h.signIn(email)).body.user.id
    await db.insert(contatos).values({ id: 'cliente', nome: 'Cliente' })
    await h.db
      .prepare('INSERT INTO acessos_revogados(email) VALUES (?)')
      .bind(email)
      .run()
    expect(
      await executarComando(db, h.env.BUCKET, gestor, {
        tipo: 'apagarContato',
        contatoId: 'cliente',
        negocios: 0,
        conversas: 0,
      }),
    ).toMatchObject({ ok: false })
    expect(await db.select().from(contatos)).toHaveLength(1)
  } finally {
    await h.dispose()
  }
})
