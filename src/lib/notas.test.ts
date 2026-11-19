import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { getDb } from '#/db'
import { user } from '#/db/auth-schema'
import { contatos, conversas, numeros, pessoasSetores } from '#/db/schema'
import { createAuthHarness } from '#/test/auth-harness'
import { medirFila } from '#/test/d1-fila'
import { type ComandoCarteira, executarComando } from './carteira-escrita'
import { lerPainel } from './carteira-leitura'
import { lerChat } from './wa-conversas'

it('J4 · H20 · a nota do contato identifica a autora e a repetição do pedido conserva uma anotação', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const autora = (await h.signIn('qa-nota@exemplo.test')).body.user.id
    await db.update(user).set({ name: 'Lia' }).where(eq(user.id, autora))
    await db.insert(contatos).values({ id: 'cliente', nome: 'Mara' })
    const criar = {
      tipo: 'criarNota' as const,
      id: randomUUID(),
      contatoId: 'cliente',
      texto: 'Telefonar após as dez.',
    }
    const gravar = () => executarComando(db, h.env.BUCKET, autora, criar)
    const [primeiro, repetido] = await Promise.all([gravar(), gravar()])
    expect(primeiro).toMatchObject({ ok: true })
    expect(repetido).toEqual(primeiro)
    const painel = await medirFila(h.db, () =>
      lerPainel(getDb(h.db), autora, { contatoId: 'cliente' }),
    )
    expect(painel.resultado.notas).toEqual([
      {
        id: criar.id,
        texto: criar.texto,
        autorNome: 'Lia',
        criadoEm: expect.any(Number),
      },
    ])
    expect(painel.filaMax).toBeLessThanOrEqual(2)
  } finally {
    await h.dispose()
  }
})

it('J4 · H20 · quem tem setor pode corrigir e apagar a nota do contato; sem setor não pode', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const gestora = (await h.signIn('qa-lia@exemplo.test')).body.user.id
    const colega = (await h.signIn('qa-colega@exemplo.test')).body.user.id
    await db.insert(contatos).values({ id: 'cliente', nome: 'Rui' })
    const criar = {
      tipo: 'criarNota' as const,
      id: randomUUID(),
      contatoId: 'cliente',
      texto: 'Ligar cedo.',
    }
    const executar = (autor: string, c: ComandoCarteira) =>
      executarComando(db, h.env.BUCKET, autor, c)
    expect(await executar(gestora, { ...criar, texto: '    ' })).toMatchObject({
      ok: false,
    })
    expect(await executar(gestora, criar)).toMatchObject({ ok: true })
    expect(
      await executar(gestora, { ...criar, texto: 'Outro pedido.' }),
    ).toMatchObject({ ok: false })
    const editar = {
      ...criar,
      tipo: 'editarNota' as const,
      texto: 'Ligar após as 10h.',
    }
    const apagar = { ...criar, tipo: 'apagarNota' as const }
    expect(await executar(colega, editar)).toMatchObject({ ok: false })
    expect(await executar(colega, apagar)).toMatchObject({ ok: false })
    await expect(
      lerPainel(db, colega, { contatoId: 'cliente' }),
    ).rejects.toThrow('Aguardando')
    expect(await executar(gestora, editar)).toMatchObject({ ok: true })
    expect(
      (await lerPainel(db, gestora, { contatoId: 'cliente' })).notas,
    ).toMatchObject([{ texto: editar.texto }])
    expect(await executar(gestora, apagar)).toMatchObject({ ok: true })
    expect(
      (await lerPainel(db, gestora, { contatoId: 'cliente' })).notas,
    ).toEqual([])
  } finally {
    await h.dispose()
  }
})

it('J4 · H15 · a nota interna fica no chat do setor sem aparecer nas notas compartilhadas do contato', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const autora = (await h.signIn('qa-gestora-nota@exemplo.test')).body.user.id
    const colega = (await h.signIn('qa-vendedor-nota@exemplo.test')).body.user
      .id
    await db
      .insert(pessoasSetores)
      .values({ usuarioId: colega, setorId: 'pos' })
    await db.insert(contatos).values({ id: 'cliente', nome: 'Mara' })
    await db.insert(numeros).values({
      id: 'vendas-1',
      setorId: 'com',
      funilPadraoId: 'vendas',
      cor: '#0f766e',
      nome: 'Vendas',
    })
    await db
      .insert(conversas)
      .values({ id: 'chat', numeroId: 'vendas-1', contatoId: 'cliente' })
    const criar = {
      tipo: 'criarNotaInterna' as const,
      contatoId: 'cliente',
      conversaId: 'chat',
      id: randomUUID(),
      texto: 'Informação só da equipe.',
    }
    const executar = (pessoa: string, c: ComandoCarteira) =>
      executarComando(db, h.env.BUCKET, pessoa, c)
    expect(await executar(colega, criar)).toMatchObject({ ok: false })
    await Promise.all([executar(autora, criar), executar(autora, criar)])
    const chat = await medirFila(h.db, () =>
      lerChat(getDb(h.db), autora, 'chat'),
    )
    expect(chat.resultado).toMatchObject([{ tipo: 'nota', texto: criar.texto }])
    expect(chat.filaMax).toBeLessThanOrEqual(2)
    expect(
      (await lerPainel(db, colega, { contatoId: 'cliente' })).notas,
    ).toEqual([])
    await expect(lerChat(db, colega, 'chat')).rejects.toThrow('Sem acesso')
    expect(
      await executar(colega, {
        ...criar,
        tipo: 'editarNota',
        texto: 'Outro texto.',
      }),
    ).toMatchObject({ ok: false })
    await executar(colega, { ...criar, tipo: 'apagarNota' })
    expect(await lerChat(db, autora, 'chat')).toMatchObject([
      { texto: criar.texto },
    ])
  } finally {
    await h.dispose()
  }
})
