import { expect, it } from 'vitest'
import { getDb } from '#/db'
import {
  contatos,
  conversas,
  negocios,
  numeros,
  pessoasSetores,
} from '#/db/schema'
import { createAuthHarness } from '#/test/auth-harness'
import { d1ComAtraso } from '#/test/d1-fila'
import { lerPainel, lerQuadro, listarContatos } from './carteira-leitura'

it('J2 · separa os quadros e as conversas das duas pessoas e conserva o resumo de outros negócios no painel', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const gestora = (await h.signIn('qa-leitura-gestora@exemplo.test')).body
      .user.id
    const vendedor = (await h.signIn('qa-leitura-vendedor@exemplo.test')).body
      .user.id
    await db
      .insert(pessoasSetores)
      .values({ usuarioId: vendedor, setorId: 'com' })
    await db.insert(numeros).values([
      {
        id: 'n1',
        nome: 'Recepção',
        cor: 'verde',
        setorId: 'com',
        funilPadraoId: 'vendas',
      },
      {
        id: 'n2',
        nome: 'Suporte',
        cor: 'azul',
        setorId: 'pos',
        funilPadraoId: 'pos',
      },
    ])
    await db.insert(contatos).values({ id: 'cliente', nome: 'Cecília' })
    await db.insert(conversas).values([
      { id: 'v1', numeroId: 'n1', contatoId: 'cliente' },
      { id: 'v2', numeroId: 'n2', contatoId: 'cliente' },
    ])
    await db.insert(negocios).values([
      {
        id: 'venda',
        contatoId: 'cliente',
        funilId: 'vendas',
        etapaId: 'novo',
        valorCentavos: 4500,
      },
      {
        id: 'reservado',
        contatoId: 'cliente',
        funilId: 'pos',
        etapaId: 'agendada',
        valorCentavos: 125000,
      },
    ])
    expect(
      (await lerQuadro(db, gestora, { funilId: 'pos' })).cartoes,
    ).toHaveLength(1)
    await expect(lerQuadro(db, vendedor, { funilId: 'pos' })).rejects.toThrow(
      'Sem acesso',
    )
    await expect(lerPainel(db, vendedor, { conversaId: 'v2' })).rejects.toThrow(
      'Sem acesso',
    )
    const filaQuadro = d1ComAtraso(h.db)
    await lerQuadro(getDb(filaQuadro.d1), vendedor, {})
    expect(filaQuadro.filaMax()).toBeLessThanOrEqual(2)
    const filaPainel = d1ComAtraso(h.db)
    const painel = await lerPainel(getDb(filaPainel.d1), vendedor, {
      conversaId: 'v1',
    })
    expect(filaPainel.filaMax()).toBeLessThanOrEqual(2)
    expect(painel.principal?.id).toBe('venda')
    expect(painel.outros).toMatchObject([
      { funilNome: 'Pós-venda', etapaNome: 'Instalação agendada' },
    ])
    expect(painel.outros[0].chave).toEqual(expect.any(String))
    expect(painel.outros[0].valorCentavos).toBeNull()
    expect(JSON.stringify(painel)).not.toContain('reservado')
    expect(painel.conversas.map((v) => v.id)).toEqual(['v1'])
    const m = d1ComAtraso(h.db)
    const lista = await listarContatos(getDb(m.d1), vendedor, {
      busca: 'cec',
      etapaId: 'novo',
    })
    expect(lista.contatos.map((c) => c.nome)).toEqual(['Cecília'])
    expect(m.filaMax()).toBeLessThanOrEqual(2)
  } finally {
    await h.dispose()
  }
})
