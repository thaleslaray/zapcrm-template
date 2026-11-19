import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { getDb } from '#/db'
import { contatos, pessoasSetores } from '#/db/schema'
import { createAuthHarness } from '#/test/auth-harness'
import { executarComando } from './carteira-escrita'
import { lerPainel } from './carteira-leitura'

it('abre o negócio com a pessoa escolhida pela gestora no setor do funil', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const gestora = (await h.signIn('qa-gestora@exemplo.test')).body.user.id
    const vendedor = (await h.signIn('qa-vendedor@exemplo.test')).body.user.id
    await db
      .insert(pessoasSetores)
      .values({ usuarioId: vendedor, setorId: 'com' })
    await db.insert(contatos).values({ id: 'cliente', nome: 'Cliente' })
    const pedido = {
      tipo: 'abrirNegocio' as const,
      id: randomUUID(),
      contatoId: 'cliente',
      funilId: 'vendas',
      responsavelId: vendedor,
    }
    expect(
      await executarComando(db, h.env.BUCKET, gestora, pedido),
    ).toMatchObject({ ok: true })
    expect(
      (await lerPainel(db, gestora, { contatoId: 'cliente' })).principal,
    ).toMatchObject({
      id: pedido.id,
      funilId: 'vendas',
      responsavelId: vendedor,
    })
  } finally {
    await h.dispose()
  }
})

it('recusa a atribuição a outra pessoa por vendedor e a atribuição fora do setor por gestora', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const gestora = (await h.signIn('qa-gestora@exemplo.test')).body.user.id
    const vendedor = (await h.signIn('qa-vendedor@exemplo.test')).body.user.id
    await db
      .insert(pessoasSetores)
      .values({ usuarioId: vendedor, setorId: 'com' })
    await db.insert(contatos).values({ id: 'cliente', nome: 'Cliente' })
    const abrir = (autor: string, funilId: string, responsavelId: string) =>
      executarComando(db, h.env.BUCKET, autor, {
        tipo: 'abrirNegocio',
        id: randomUUID(),
        contatoId: 'cliente',
        funilId,
        responsavelId,
      })
    expect
      .soft(await abrir(vendedor, 'vendas', gestora))
      .toMatchObject({ ok: false })
    expect
      .soft(await abrir(gestora, 'pos', vendedor))
      .toMatchObject({ ok: false })
    expect
      .soft(await abrir(vendedor, 'pos', vendedor))
      .toMatchObject({ ok: false })
    expect(
      (await lerPainel(db, gestora, { contatoId: 'cliente' })).totalNegocios,
    ).toBe(0)
    expect(await abrir(vendedor, 'vendas', vendedor)).toMatchObject({
      ok: true,
    })
  } finally {
    await h.dispose()
  }
})
