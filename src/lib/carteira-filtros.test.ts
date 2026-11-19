import { expect, it } from 'vitest'
import { getDb } from '#/db'
import { contatos, conversas, negocios, numeros } from '#/db/schema'
import { createAuthHarness } from '#/test/auth-harness'
import { lerQuadro, listarContatos } from './carteira-leitura'

it('o cartão de instalação abre e aceita filtro somente pela conversa do seu setor', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const gestor = (await h.signIn('qa-quadro@exemplo.test')).body.user.id
    await db.insert(numeros).values([
      {
        id: 'recepcao',
        nome: 'Recepção',
        setorId: 'com',
        cor: 'verde',
        funilPadraoId: 'vendas',
      },
      {
        id: 'suporte',
        nome: 'Suporte',
        setorId: 'pos',
        cor: 'azul',
        funilPadraoId: 'pos',
      },
    ])
    await db.insert(contatos).values({ id: 'cliente', nome: 'Cliente' })
    await db.insert(conversas).values({
      id: 'recepcao-cliente',
      contatoId: 'cliente',
      numeroId: 'recepcao',
    })
    await db.insert(negocios).values({
      id: 'instalacao',
      contatoId: 'cliente',
      funilId: 'pos',
      etapaId: 'agendada',
    })
    const cartoes = async (numeroId?: string) =>
      (await lerQuadro(db, gestor, { funilId: 'pos', numeroId })).cartoes
    expect((await cartoes())[0].conversa).toBeNull()
    await db.insert(conversas).values({
      id: 'suporte-cliente',
      contatoId: 'cliente',
      numeroId: 'suporte',
    })
    expect(await cartoes('suporte')).toMatchObject([
      {
        id: 'instalacao',
        numeroId: 'suporte',
        conversa: { id: 'suporte-cliente' },
      },
    ])
  } finally {
    await h.dispose()
  }
})

it('a etapa de fechamento encontra os contatos com negócios naquele resultado', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const gestor = (await h.signIn('qa-filtro@exemplo.test')).body.user.id
    await db.insert(contatos).values({ id: 'cliente', nome: 'Cliente' })
    await db.insert(negocios).values({
      id: 'venda',
      contatoId: 'cliente',
      funilId: 'vendas',
      etapaId: 'ganho',
      fechadoEm: new Date(),
    })
    const lista = await listarContatos(db, gestor, { etapaId: 'ganho' })
    expect(lista.contatos).toMatchObject([
      { id: 'cliente', abertos: [], valorCentavos: 0 },
    ])
  } finally {
    await h.dispose()
  }
})
