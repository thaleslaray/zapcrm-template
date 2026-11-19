import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { getDb } from '#/db'
import { user } from '#/db/auth-schema'
import { contatos, negocios, numeros, pessoasSetores } from '#/db/schema'
import { createAuthHarness } from '#/test/auth-harness'
import { medirFila } from '#/test/d1-fila'
import { alterarEstrutura, listarEstrutura } from './estrutura'

it('J5 · H41a · só a gestora administra setores, uma repetição mantém o cadastro e o setor precisa estar vazio para sair', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const gestora = (await h.signIn('qa-estrutura-gestora@exemplo.test')).body
      .user.id
    const vendedor = (await h.signIn('qa-estrutura-vendedor@exemplo.test')).body
      .user.id
    const criar = {
      tipo: 'criarSetor',
      id: 'instalacao',
      nome: 'Instalação',
    } as const
    await expect(listarEstrutura(db, vendedor)).rejects.toThrow('Sem acesso')
    await expect(alterarEstrutura(db, vendedor, criar)).rejects.toThrow(
      'Sem acesso',
    )
    await Promise.all([
      alterarEstrutura(db, gestora, criar),
      alterarEstrutura(db, gestora, criar),
    ])
    await alterarEstrutura(db, gestora, {
      ...criar,
      tipo: 'editarSetor',
      nome: 'Projetos',
    })
    await expect(alterarEstrutura(db, gestora, criar)).rejects.toThrow(
      'outros dados',
    )
    await db
      .insert(pessoasSetores)
      .values({ usuarioId: vendedor, setorId: criar.id })
    const medida = await medirFila(h.db, () =>
      listarEstrutura(getDb(h.db), gestora),
    )
    expect(medida.resultado.setores.filter((s) => s.id === criar.id)).toEqual([
      { id: 'instalacao', nome: 'Projetos', abertos: 0 },
    ])
    expect(medida.resultado.pessoas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: vendedor,
          papel: 'vendedor',
          setorId: criar.id,
        }),
        expect.objectContaining({
          id: gestora,
          papel: 'gestor',
          setorId: null,
        }),
      ]),
    )
    expect(medida.filaMax).toBe(1)
    await expect(
      alterarEstrutura(db, gestora, { tipo: 'apagarSetor', id: criar.id }),
    ).rejects.toThrow('vazio')
    await alterarEstrutura(db, gestora, { ...criar, id: 'vazio' })
    await alterarEstrutura(db, gestora, { tipo: 'apagarSetor', id: 'vazio' })
    expect(
      (await listarEstrutura(db, gestora)).setores.map((s) => s.id),
    ).not.toContain('vazio')
    // Contas encerradas continuam no D1 durante a retenção, fora da equipe.
    await db
      .update(user)
      .set({ deletedAt: new Date() })
      .where(eq(user.id, vendedor))
    expect(
      (await listarEstrutura(db, gestora)).pessoas.map((p) => p.id),
    ).not.toContain(vendedor)
    await alterarEstrutura(db, gestora, { tipo: 'apagarSetor', id: criar.id })
  } finally {
    await h.dispose()
  }
})

it('J5 · H42–42a · configura a ordem, o fechamento e o número de entrada sem alterar o histórico dos negócios', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db),
      gestora = (await h.signIn('qa-funil-gestora@exemplo.test')).body.user.id
    const executar = (cmd: Parameters<typeof alterarEstrutura>[2]) =>
      alterarEstrutura(db, gestora, cmd)
    const funil = {
      tipo: 'criarFunil',
      id: 'suporte',
      setorId: 'com',
      nome: 'Suporte',
      cor: '#334455',
    } as const
    await Promise.all([executar(funil), executar(funil)])
    const etapasDoFunil = async () =>
      (await listarEstrutura(db, gestora)).etapas.filter(
        (e) => e.funilId === funil.id,
      )
    const [inicial] = await etapasDoFunil()
    expect((await etapasDoFunil()).map((e) => e.nome)).toEqual(['Novo'])
    const aberta = {
      tipo: 'criarEtapa',
      id: 'triagem',
      nome: 'Triagem',
      cor: '#16a34a',
      fechamento: null,
      funilId: funil.id,
    } as const
    const ganha = {
      ...aberta,
      id: 'resolvido',
      nome: 'Resolvido',
      fechamento: 'sucesso',
    } as const
    await executar(aberta)
    await executar(ganha)
    await executar({
      ...ganha,
      id: 'cancelado-suporte',
      nome: 'Cancelado',
      fechamento: 'perda',
    })
    await expect(executar({ ...ganha, id: 'outra' })).rejects.toThrow(
      'fechamento',
    )
    const ids = [aberta.id, inicial.id, ganha.id, 'cancelado-suporte']
    await executar({ tipo: 'ordenarEtapas', funilId: funil.id, ids })
    await executar({ tipo: 'ordenarEtapas', funilId: funil.id, ids })
    await expect(
      executar({
        tipo: 'ordenarEtapas',
        funilId: funil.id,
        ids: [...ids, 'ganho'],
      }),
    ).rejects.toThrow('etapas')
    await executar({
      ...aberta,
      tipo: 'editarEtapa',
      nome: 'Em atendimento',
      cor: '#112233',
    })
    expect((await etapasDoFunil()).map((e) => e.id)).toEqual(ids)
    expect((await etapasDoFunil())[0]).toMatchObject({
      nome: 'Em atendimento',
      cor: '#112233',
    })
    await db.insert(numeros).values({
      id: 'com-support',
      nome: 'Suporte',
      cor: '#112233',
      setorId: 'com',
      funilPadraoId: 'vendas',
    })
    await expect(
      executar({
        tipo: 'definirFunilPadrao',
        numeroId: 'com-support',
        funilId: 'pos',
      }),
    ).rejects.toThrow('setor')
    await executar({
      tipo: 'definirFunilPadrao',
      numeroId: 'com-support',
      funilId: funil.id,
    })
    await db.insert(contatos).values({ id: 'pedro', nome: 'Pedro' })
    await db.insert(negocios).values({
      id: 'ajuda',
      contatoId: 'pedro',
      funilId: funil.id,
      etapaId: aberta.id,
    })
    await expect(
      executar({ tipo: 'apagarEtapa', id: aberta.id }),
    ).rejects.toThrow('negócio')
    await expect(
      executar({ ...aberta, tipo: 'editarEtapa', fechamento: 'sucesso' }),
    ).rejects.toThrow('negócio')
    await expect(
      executar({ tipo: 'apagarFunil', id: funil.id }),
    ).rejects.toThrow('número')
    await executar({ tipo: 'apagarEtapa', id: ganha.id })
    await executar({ ...funil, tipo: 'editarFunil', nome: 'Suporte técnico' })
    const estrutura = await listarEstrutura(db, gestora)
    expect(estrutura.funis).toContainEqual(
      expect.objectContaining({ id: funil.id, nome: 'Suporte técnico' }),
    )
    expect(estrutura.numeros).toContainEqual(
      expect.objectContaining({ id: 'com-support', funilPadraoId: funil.id }),
    )
    expect(estrutura.etapas).toContainEqual(
      expect.objectContaining({ id: aberta.id, negocios: 1 }),
    )
    expect(estrutura.setores).toContainEqual(
      expect.objectContaining({ id: 'com', abertos: 1 }),
    )
    await executar({ ...funil, id: 'rascunho' })
    const { etapas: etapasSalvas } = await listarEstrutura(db, gestora)
    const etapaInicial = etapasSalvas.find((e) => e.funilId === 'rascunho')
    if (!etapaInicial) throw new Error('Falta a etapa inicial do rascunho.')
    await expect(
      executar({ tipo: 'apagarEtapa', id: etapaInicial.id }),
    ).rejects.toThrow('etapa aberta')
    await expect(
      executar({ ...etapaInicial, tipo: 'editarEtapa', fechamento: 'perda' }),
    ).rejects.toThrow('etapa aberta')
    await executar({ tipo: 'apagarFunil', id: 'rascunho' })
    expect(
      (await listarEstrutura(db, gestora)).funis.map((f) => f.id),
    ).not.toContain('rascunho')
  } finally {
    await h.dispose()
  }
})
