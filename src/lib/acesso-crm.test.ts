import { expect, it } from 'vitest'

import { getDb } from '#/db'
import { etapas, numeros, pessoasSetores } from '#/db/schema'
import { setoresVisiveis } from '#/lib/acesso-crm'
import { createAuthHarness } from '#/test/auth-harness'

it('a primeira sessão abre a instalação com uma gestora e os dois funis', async () => {
  const h = await createAuthHarness()
  try {
    const { body } = await h.signIn('qa-gestora@exemplo.test')
    expect(await setoresVisiveis(getDb(h.db), body.user.id)).toEqual({
      papel: 'gestor',
      setores: ['com', 'pos'],
      numeros: [],
      funis: ['pos', 'vendas'],
    })
    const iniciais = await getDb(h.db)
      .select({
        nome: etapas.nome,
        funil: etapas.funilId,
        fechamento: etapas.fechamento,
      })
      .from(etapas)
      .orderBy(etapas.funilId, etapas.posicao)
    expect(iniciais.map((e) => [e.funil, e.nome, e.fechamento])).toEqual([
      ['pos', 'Instalação agendada', null],
      ['pos', 'Instalado', null],
      ['pos', 'Homologação', null],
      ['pos', 'Concluído', 'sucesso'],
      ['pos', 'Cancelado', 'perda'],
      ['vendas', 'Novo', null],
      ['vendas', 'Qualificado', null],
      ['vendas', 'Proposta', null],
      ['vendas', 'Negociação', null],
      ['vendas', 'Ganho', 'sucesso'],
      ['vendas', 'Perdido', 'perda'],
    ])
  } finally {
    await h.dispose()
  }
})

it('vendedor só vê números e funis dos setores liberados, inclusive ao entrar outra vez', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const gestora = await h.signIn('qa-gestora@exemplo.test')
    const vendedor = await h.signIn('qa-vendedor@exemplo.test')
    const usuarioId = vendedor.body.user.id
    expect(await setoresVisiveis(db, usuarioId)).toEqual({
      papel: 'vendedor',
      setores: [],
      funis: [],
      numeros: [],
    })

    await db.insert(numeros).values([
      {
        id: 'com-1',
        setorId: 'com',
        nome: 'Comercial',
        cor: '#0f766e',
        funilPadraoId: 'vendas',
      },
      {
        id: 'pos-1',
        setorId: 'pos',
        nome: 'Pós-venda',
        cor: '#2563eb',
        funilPadraoId: 'pos',
      },
    ])
    await db.insert(pessoasSetores).values({ usuarioId, setorId: 'pos' })
    await h.signIn('qa-vendedor@exemplo.test')
    expect(await setoresVisiveis(db, usuarioId)).toEqual({
      papel: 'vendedor',
      setores: ['pos'],
      funis: ['pos'],
      numeros: ['pos-1'],
    })
    expect((await setoresVisiveis(db, gestora.body.user.id)).numeros).toEqual([
      'com-1',
      'pos-1',
    ])
  } finally {
    await h.dispose()
  }
})
