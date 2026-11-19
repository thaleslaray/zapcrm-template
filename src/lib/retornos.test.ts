import { expect, it } from 'vitest'
import { getDb } from '#/db'
import {
  contatos,
  conversas,
  negocios,
  numeros,
  pessoasSetores,
  retornos,
} from '#/db/schema'
import { createAuthHarness } from '#/test/auth-harness'
import { medirFila } from '#/test/d1-fila'
import { executarComando } from './carteira-escrita'
import { lerPainel, lerQuadro } from './carteira-leitura'
import { lerAgenda } from './retornos-leitura'
import { listarConversas } from './wa-conversas'

async function preparar() {
  const h = await createAuthHarness()
  const db = getDb(h.db)
  const gestor = (await h.signIn('qa-agenda-gestor@exemplo.test')).body.user.id
  const vendedor = (await h.signIn('qa-agenda-vendedor@exemplo.test')).body.user
    .id
  await db
    .insert(pessoasSetores)
    .values({ usuarioId: vendedor, setorId: 'com' })
  await db.insert(numeros).values([
    {
      id: 'vendas1',
      nome: 'Recepção',
      cor: '#0f766e',
      setorId: 'com',
      funilPadraoId: 'vendas',
    },
    {
      id: 'suporte1',
      nome: 'Suporte',
      cor: '#2563eb',
      setorId: 'pos',
      funilPadraoId: 'pos',
    },
  ])
  await db.insert(contatos).values({ id: 'alva', nome: 'Alva Ribeiro' })
  await db.insert(conversas).values([
    { id: 'cv', numeroId: 'vendas1', contatoId: 'alva' },
    { id: 'cs', numeroId: 'suporte1', contatoId: 'alva' },
  ])
  await db.insert(negocios).values({
    id: 'nv',
    contatoId: 'alva',
    funilId: 'vendas',
    etapaId: 'novo',
    numeroId: 'vendas1',
    responsavelId: vendedor,
  })
  return { h, db, gestor, vendedor }
}

it('J4 · o retorno do número aberto aparece no painel, na conversa e no cartão mesmo quando outra pessoa o marcou', async () => {
  const { h, db, gestor, vendedor } = await preparar()
  try {
    await db.insert(retornos).values([
      {
        id: 'antigo',
        contatoId: 'alva',
        numeroId: 'suporte1',
        responsavelId: gestor,
        motivo: 'Instalação',
        marcadoPara: new Date(2020, 1, 1),
      },
      {
        id: 'visita',
        contatoId: 'alva',
        numeroId: 'vendas1',
        responsavelId: gestor,
        motivo: 'Visita',
        marcadoPara: new Date(2021, 1, 1),
      },
    ])
    expect(
      (await lerPainel(db, gestor, { conversaId: 'cv' })).retorno?.motivo,
    ).toBe('Visita')
    expect(
      (await lerQuadro(db, vendedor, { funilId: 'vendas' })).cartoes[0].retorno
        ?.motivo,
    ).toBe('Visita')
    expect((await listarConversas(db, vendedor)).lista).toMatchObject([
      { id: 'cv', atraso: 1 },
    ])
  } finally {
    await h.dispose()
  }
})

it('J4 · criar duas vezes confirma o mesmo retorno, e somente um colega do setor pode alterá-lo ou desfazer', async () => {
  const { h, db, gestor, vendedor } = await preparar()
  try {
    const c = {
      tipo: 'retorno' as const,
      acao: 'marcar' as const,
      id: crypto.randomUUID(),
      contatoId: 'alva',
      numeroId: 'suporte1',
      motivo: 'Instalar',
      marcadoPara: Date.now() - 60_000,
    }
    const gravar = (
      pessoa: string,
      comando: Parameters<typeof executarComando>[3],
    ) => executarComando(db, h.env.BUCKET, pessoa, comando)
    expect(
      await Promise.all([gravar(gestor, c), gravar(gestor, c)]),
    ).toMatchObject([{ ok: true }, { ok: true }])
    const concluir = { ...c, acao: 'feito' as const }
    expect(await gravar(vendedor, c)).toMatchObject({ ok: false })
    expect(await gravar(vendedor, concluir)).toMatchObject({ ok: false })
    expect(
      await gravar(vendedor, { ...concluir, numeroId: 'vendas1' }),
    ).toMatchObject({ ok: false })
    expect(
      (await lerPainel(db, gestor, { conversaId: 'cs' })).retorno?.motivo,
    ).toBe('Instalar')
    expect(
      await gravar(gestor, { ...c, acao: 'alterar', motivo: 'Visitar' }),
    ).toMatchObject({ ok: true })
    expect(await gravar(gestor, concluir)).toMatchObject({ ok: true })
    expect(
      (await lerPainel(db, gestor, { conversaId: 'cs' })).retorno,
    ).toBeNull()
    expect(await gravar(gestor, { ...c, acao: 'desfazer' })).toMatchObject({
      ok: true,
    })
    expect(
      (await lerPainel(db, gestor, { conversaId: 'cs' })).retorno?.motivo,
    ).toBe('Visitar')
    expect(
      await gravar(gestor, {
        ...c,
        acao: 'adiar',
        marcadoPara: Date.now() + 86400000,
      }),
    ).toMatchObject({ ok: true })
    expect(
      (await listarConversas(db, gestor)).lista.find((v) => v.id === 'cs')
        ?.atraso,
    ).toBe(0)
  } finally {
    await h.dispose()
  }
})

it('J4 · agenda e contador respeitam setores e a leitura da equipe usa até duas idas em fila', async () => {
  const { h, db, gestor, vendedor } = await preparar()
  try {
    const ontem = new Date(Date.now() - 86400000)
    await db.insert(retornos).values([
      {
        id: 'venda',
        contatoId: 'alva',
        numeroId: 'vendas1',
        responsavelId: vendedor,
        motivo: 'Negociar',
        marcadoPara: ontem,
      },
      {
        id: 'pos',
        contatoId: 'alva',
        numeroId: 'suporte1',
        responsavelId: gestor,
        motivo: 'Instalar',
        marcadoPara: ontem,
      },
    ])
    const { resultado, filaMax } = await medirFila(h.db, () =>
      lerAgenda(getDb(h.db), gestor),
    )
    expect(resultado.itens.map((r) => r.motivo).sort()).toEqual([
      'Instalar',
      'Negociar',
    ])
    expect(filaMax).toBeLessThanOrEqual(2)
    expect((await lerAgenda(db, vendedor)).itens).toMatchObject([
      { motivo: 'Negociar', conversaId: 'cv' },
    ])
    expect((await listarConversas(db, gestor)).atrasados).toBe(2)
    expect((await listarConversas(db, vendedor)).atrasados).toBe(1)
  } finally {
    await h.dispose()
  }
})

it('cada retorno agendado tem atalho para a conversa do mesmo número', async () => {
  const { h, db, gestor } = await preparar()
  try {
    await db.insert(contatos).values({
      id: 'cliente-retorno',
      nome: 'Cliente',
      telefone: '(11) 95555-4321',
      telefoneNormalizado: '551155554321',
    })
    const pedido = {
      tipo: 'retorno' as const,
      acao: 'marcar' as const,
      id: crypto.randomUUID(),
      contatoId: 'cliente-retorno',
      numeroId: 'suporte1',
      motivo: 'Seguir com a instalação',
      marcadoPara: Date.now(),
    }
    expect(
      await executarComando(db, h.env.BUCKET, gestor, pedido),
    ).toMatchObject({ ok: true })
    expect(
      (await lerAgenda(db, gestor)).itens.find((r) => r.id === pedido.id),
    ).toMatchObject({ numeroId: 'suporte1', conversaId: expect.any(String) })
  } finally {
    await h.dispose()
  }
})
