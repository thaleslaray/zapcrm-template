import { expect, it } from 'vitest'
import { getDb } from '#/db'
import { contatos, pessoasSetores } from '#/db/schema'
import { createAuthHarness } from '#/test/auth-harness'
import { medirFila } from '#/test/d1-fila'
import { listarContatos } from './carteira-leitura'
import {
  alterarCatalogo,
  listarEtiquetasGestao,
  listarRespostas,
} from './catalogos'

it('J5 · o gestor mantém a etiqueta e o vendedor com setor a aplica ao contato para filtrar a carteira', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const gestora = (await h.signIn('qa-tags-gestora@exemplo.test')).body.user
      .id
    const vendedor = (await h.signIn('qa-tags-vendedor@exemplo.test')).body.user
      .id
    await db.insert(contatos).values([
      { id: 'cliente', nome: 'Marina' },
      { id: 'outro', nome: 'Bia' },
    ])
    const etiqueta = {
      tipo: 'criarEtiqueta',
      id: 'visita',
      nome: 'Visita',
      cor: '#0f766e',
    } as const
    await Promise.all([
      alterarCatalogo(db, gestora, etiqueta),
      alterarCatalogo(db, gestora, etiqueta),
    ])
    await expect(
      alterarCatalogo(db, gestora, { ...etiqueta, nome: 'Mudou após repetir' }),
    ).rejects.toThrow('cadastro anterior')
    const aplicar = {
      tipo: 'vincularEtiqueta',
      id: 'visita',
      contatoId: 'cliente',
      presente: true,
    } as const
    await expect(alterarCatalogo(db, vendedor, aplicar)).rejects.toThrow(
      'Aguardando',
    )
    await db
      .insert(pessoasSetores)
      .values({ usuarioId: vendedor, setorId: 'com' })
    await expect(listarEtiquetasGestao(db, vendedor)).rejects.toThrow(
      'Sem acesso',
    )
    await expect(
      alterarCatalogo(db, vendedor, { ...etiqueta, tipo: 'editarEtiqueta' }),
    ).rejects.toThrow('Sem acesso')
    await Promise.all([
      alterarCatalogo(db, vendedor, aplicar),
      alterarCatalogo(db, vendedor, aplicar),
    ])
    const medida = await medirFila(h.db, () =>
      listarEtiquetasGestao(getDb(h.db), gestora),
    )
    expect(medida.resultado).toMatchObject([{ nome: 'Visita', contatos: 1 }])
    expect(medida.filaMax).toBeLessThanOrEqual(2)
    await alterarCatalogo(db, gestora, {
      ...etiqueta,
      tipo: 'editarEtiqueta',
      nome: 'Visita técnica',
      cor: '#112233',
    })
    const lista = await listarContatos(db, vendedor, { etiquetaId: 'visita' })
    expect(lista.contatos.map((c) => c.nome)).toEqual(['Marina'])
    expect(lista.contatos[0].etiquetas).toEqual([
      {
        id: 'visita',
        nome: 'Visita técnica',
        cor: '#112233',
        contatoId: 'cliente',
      },
    ])
    await alterarCatalogo(db, vendedor, { ...aplicar, presente: false })
    expect(
      (await listarContatos(db, vendedor, { etiquetaId: 'visita' })).contatos,
    ).toEqual([])
    await alterarCatalogo(db, vendedor, aplicar)
    await alterarCatalogo(db, gestora, { tipo: 'apagarEtiqueta', id: 'visita' })
    expect(await listarEtiquetasGestao(db, gestora)).toEqual([])
    expect(
      (await listarContatos(db, vendedor, { etiquetaId: 'visita' })).contatos,
    ).toEqual([])
  } finally {
    await h.dispose()
  }
})

it('J5 · mostra respostas cadastradas pela gestora a um vendedor com setor e preserva o texto na repetição', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const gestora = (await h.signIn('qa-resp-gestora@exemplo.test')).body.user
      .id
    const vendedor = (await h.signIn('qa-resp-vendedor@exemplo.test')).body.user
      .id
    const resposta = {
      tipo: 'criarResposta',
      id: 'ola',
      atalho: '/ola',
      texto: 'Posso ajudar?',
    } as const
    await Promise.all([
      alterarCatalogo(db, gestora, resposta),
      alterarCatalogo(db, gestora, resposta),
    ])
    await expect(
      alterarCatalogo(db, gestora, { ...resposta, texto: 'Outro rascunho' }),
    ).rejects.toThrow('cadastro anterior')
    await expect(listarRespostas(db, vendedor)).rejects.toThrow('Aguardando')
    await db
      .insert(pessoasSetores)
      .values({ usuarioId: vendedor, setorId: 'pos' })
    await expect(
      alterarCatalogo(db, vendedor, { tipo: 'apagarResposta', id: 'ola' }),
    ).rejects.toThrow('Sem acesso')
    await expect(
      alterarCatalogo(db, gestora, { ...resposta, id: 'outro' }),
    ).rejects.toThrow('já existe')
    await expect(
      alterarCatalogo(db, gestora, { ...resposta, atalho: 'sem barra' }),
    ).rejects.toThrow('atalho')
    await alterarCatalogo(db, gestora, {
      ...resposta,
      tipo: 'editarResposta',
      texto: 'Em que posso ajudar?',
    })
    const medida = await medirFila(h.db, () =>
      listarRespostas(getDb(h.db), vendedor),
    )
    expect(medida.resultado).toEqual([
      { id: 'ola', atalho: '/ola', texto: 'Em que posso ajudar?' },
    ])
    expect(medida.filaMax).toBeLessThanOrEqual(2)
    await alterarCatalogo(db, gestora, { tipo: 'apagarResposta', id: 'ola' })
    expect(await listarRespostas(db, vendedor)).toEqual([])
  } finally {
    await h.dispose()
  }
})
