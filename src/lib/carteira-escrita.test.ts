import '#/lib/audit-d1'
import { randomUUID } from 'node:crypto'
import { count, eq } from 'drizzle-orm'
import { expect, it } from 'vitest'

import { getDb } from '#/db'
import {
  arquivosEmExclusao,
  auditLog,
  contatos,
  conversas,
  mensagens,
  negocios,
  notas,
  numeros,
  pessoasSetores,
  retornos,
} from '#/db/schema'
import { type ComandoCarteira, executarComando } from '#/lib/carteira-escrita'
import { runJobs } from '#/lib/jobs'
import { destinoDaConversa } from '#/lib/wa-conversas-envio'
import { createAuthHarness } from '#/test/auth-harness'

it('cadastra o contato uma vez e aponta para ele ao repetir o telefone sem o nono dígito', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const { body } = await h.signIn('qa-gestora@exemplo.test')
    await db.insert(numeros).values({
      id: 'com-1',
      nome: 'Comercial',
      setorId: 'com',
      cor: '#0f766e',
      funilPadraoId: 'vendas',
    })
    const pedido = {
      tipo: 'criarContato' as const,
      id: randomUUID(),
      nome: 'Cliente',
      telefone: '(11) 98765-4321',
      numeroId: 'com-1',
    }
    const criar = (entrada: typeof pedido) =>
      executarComando(db, h.env.BUCKET, body.user.id, entrada)
    const respostas = await Promise.all([criar(pedido), criar(pedido)])
    expect(respostas[0]).toEqual({
      ok: true,
      contatoId: pedido.id,
      conversaId: expect.any(String),
    })
    expect(respostas[1]).toEqual(respostas[0])
    // Se o usuário alterar a digitação depois de perder a resposta, o reenvio
    // não pode dizer que gravou a alteração que só existe no formulário.
    expect(
      await criar({ ...pedido, nome: 'Nome alterado no reenvio' }),
    ).toMatchObject({ ok: false, existenteId: pedido.id })
    expect(
      await criar({ ...pedido, id: randomUUID(), telefone: '(11) 8765-4321' }),
    ).toMatchObject({ ok: false, existenteId: pedido.id })
  } finally {
    await h.dispose()
  }
})

it('fixa o endereço internacional do envio ativo na conversa e permite sua correção por quem cuida do número', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const gestor = (await h.signIn('qa-gestor@exemplo.test')).body.user.id
    await db.insert(numeros).values({
      id: 'linha',
      nome: 'Vendas',
      cor: 'verde',
      setorId: 'com',
      funilPadraoId: 'vendas',
      estadoEm: new Date(),
    })
    const ficha = {
      id: randomUUID(),
      nome: 'Cliente',
      numeroId: 'linha',
      telefone: '(11) 98765-4321',
    }
    const criado = await executarComando(db, h.env.BUCKET, gestor, {
      tipo: 'criarContato',
      ...ficha,
    })
    if (!criado.ok || !criado.conversaId) throw new Error('Conversa esperada')
    const conversaId = criado.conversaId
    const destino = async () =>
      (await destinoDaConversa(db, gestor, conversaId)).destino
    expect(await destino()).toBe('5511987654321@s.whatsapp.net')
    // O endereço do chat é independente da apresentação do telefone na ficha.
    await db
      .update(contatos)
      .set({ telefone: null })
      .where(eq(contatos.id, ficha.id))
    expect(await destino()).toBe('5511987654321@s.whatsapp.net')
    const editar = {
      tipo: 'editarContato' as const,
      contatoId: ficha.id,
      nome: ficha.nome,
      telefone: '+1 (202) 555-0148',
    }
    const colega = (await h.signIn('qa-pos@exemplo.test')).body.user.id
    await db
      .insert(pessoasSetores)
      .values({ usuarioId: colega, setorId: 'pos' })
    expect(
      await executarComando(db, h.env.BUCKET, colega, editar),
    ).toMatchObject({ ok: false })
    expect(
      await executarComando(db, h.env.BUCKET, gestor, editar),
    ).toMatchObject({ ok: true })
    expect(await destino()).toBe('12025550148@s.whatsapp.net')
  } finally {
    await h.dispose()
  }
})

it('abre um negócio por funil e ganha uma única vez mesmo com pedidos concorrentes', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const { body } = await h.signIn('qa-gestora@exemplo.test')
    await db.insert(contatos).values({ id: 'a', nome: 'Cliente' })
    const cmd = (c: ComandoCarteira) =>
      executarComando(db, h.env.BUCKET, body.user.id, c)
    const abrir = {
      tipo: 'abrirNegocio' as const,
      id: randomUUID(),
      contatoId: 'a',
      funilId: 'vendas',
      valorCentavos: 180000,
    }
    const [venda, repetida] = await Promise.all([cmd(abrir), cmd(abrir)])
    expect(venda).toEqual({ ok: true, contatoId: 'a', negocioId: abrir.id })
    expect(repetida).toEqual(venda)
    expect(await cmd({ ...abrir, valorCentavos: 190000 })).toMatchObject({
      ok: false,
    })
    expect(await cmd({ ...abrir, id: randomUUID() })).toMatchObject({
      ok: false,
      mensagem: expect.stringContaining('aberto'),
    })
    const ganhar = {
      tipo: 'moverNegocio' as const,
      negocioId: abrir.id,
      etapaId: 'ganho',
    }
    const [primeira, segunda] = await Promise.all([cmd(ganhar), cmd(ganhar)])
    expect(primeira).toMatchObject({
      ok: true,
      posVenda: { etapa: 'Instalação agendada', podeAbrir: true },
    })
    expect(segunda).toEqual(primeira)
    const negociosSalvos = await db.select().from(negocios)
    expect(negociosSalvos).toHaveLength(2)
    expect(negociosSalvos.find((n) => n.funilId === 'pos')).toMatchObject({
      origemId: abrir.id,
      etapaId: 'agendada',
      valorCentavos: null,
      fechadoEm: null,
    })
    expect(negociosSalvos.find((n) => n.funilId === 'vendas')).toMatchObject({
      etapaId: 'ganho',
      valorCentavos: 180000,
      fechadoEm: expect.any(Date),
    })
  } finally {
    await h.dispose()
  }
})

it('recusa o segundo ganho até concluir a instalação anterior e vincula a nova instalação à segunda venda', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const gestora = (await h.signIn('qa-gestora@exemplo.test')).body.user.id
    await db.insert(contatos).values({ id: 'cliente', nome: 'Cliente' })
    await db.insert(negocios).values([
      {
        id: 'primeira',
        contatoId: 'cliente',
        funilId: 'vendas',
        etapaId: 'ganho',
        fechadoEm: new Date(),
      },
      {
        id: 'instalacao',
        contatoId: 'cliente',
        funilId: 'pos',
        etapaId: 'agendada',
        origemId: 'primeira',
      },
      {
        id: 'ampliacao',
        contatoId: 'cliente',
        funilId: 'vendas',
        etapaId: 'proposta',
      },
    ])
    const mover = (negocioId: string, etapaId: string) =>
      executarComando(db, h.env.BUCKET, gestora, {
        tipo: 'moverNegocio',
        negocioId,
        etapaId,
      })
    const negociosDoContato = () =>
      db.select().from(negocios).orderBy(negocios.id)
    const antes = await negociosDoContato()
    expect(await mover('ampliacao', 'ganho')).toEqual({
      ok: false,
      mensagem:
        'Este contato tem uma instalação em aberto no Pós-venda. Conclua a instalação anterior antes de ganhar esta venda.',
    })
    expect(await negociosDoContato()).toEqual(antes)

    expect(await mover('instalacao', 'concluido')).toMatchObject({ ok: true })
    const ganho = await mover('ampliacao', 'ganho')
    expect(ganho).toMatchObject({
      ok: true,
      posVenda: { etapa: 'Instalação agendada' },
    })
    expect(await mover('ampliacao', 'ganho')).toEqual(ganho)
    const depois = await negociosDoContato()
    expect(depois).toHaveLength(4)
    expect(depois).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ampliacao',
          etapaId: 'ganho',
          fechadoEm: expect.any(Date),
        }),
        expect.objectContaining({
          funilId: 'pos',
          origemId: 'ampliacao',
          etapaId: 'agendada',
          fechadoEm: null,
        }),
        expect.objectContaining({
          id: 'instalacao',
          origemId: 'primeira',
          etapaId: 'concluido',
        }),
      ]),
    )
  } finally {
    await h.dispose()
  }
})

it('duas pessoas: só a gestora troca responsável e o vendedor só altera negócios do próprio setor', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const gestora = (await h.signIn('qa-gestora@exemplo.test')).body.user.id
    const vendedor = (await h.signIn('qa-vendedor@exemplo.test')).body.user.id
    await db.insert(contatos).values({ id: 'a', nome: 'Cliente' })
    await db
      .insert(pessoasSetores)
      .values({ usuarioId: vendedor, setorId: 'com' })
    const cmd = (pessoa: string, c: ComandoCarteira) =>
      executarComando(db, h.env.BUCKET, pessoa, c)
    const abrir = {
      tipo: 'abrirNegocio' as const,
      id: randomUUID(),
      contatoId: 'a',
      funilId: 'pos',
    }
    const negar = { ok: false, mensagem: 'Sem acesso.' }
    expect(await cmd(vendedor, abrir)).toEqual(negar)
    expect(await cmd(gestora, abrir)).toMatchObject({ ok: true })
    expect(
      await cmd(vendedor, {
        tipo: 'moverNegocio',
        negocioId: abrir.id,
        etapaId: 'instalado',
      }),
    ).toEqual(negar)
    const venda = { ...abrir, id: randomUUID(), funilId: 'vendas' }
    await cmd(vendedor, venda)
    const trocar = {
      tipo: 'trocarResponsavel' as const,
      negocioId: venda.id,
      responsavelId: gestora,
    }
    expect(await cmd(vendedor, trocar)).toEqual(negar)
    expect(await cmd(gestora, trocar)).toMatchObject({ ok: true })
    const editar = {
      tipo: 'editarContato' as const,
      contatoId: 'a',
      nome: 'Cliente editado',
      telefone: '(11) 95555-1111',
      negocio: { id: abrir.id, valorCentavos: 15000 },
    }
    expect(await cmd(vendedor, editar)).toEqual(negar)
    expect((await db.select().from(contatos))[0].nome).toBe('Cliente')
    expect(
      await cmd(vendedor, {
        ...editar,
        negocio: { ...editar.negocio, id: venda.id },
      }),
    ).toMatchObject({ ok: true })
    expect(
      (await db.select().from(negocios)).find((n) => n.id === venda.id),
    ).toMatchObject({ responsavelId: gestora, valorCentavos: 15000 })
    expect((await db.select().from(contatos))[0].nome).toBe('Cliente editado')
    // O Pós-venda deste contato foi aberto pela gestora antes de ganhar a venda.
    const ganho = await cmd(vendedor, {
      tipo: 'moverNegocio',
      negocioId: venda.id,
      etapaId: 'ganho',
    })
    expect(ganho).toMatchObject({
      ok: true,
      contatoId: 'a',
      negocioId: venda.id,
    })
    expect(ganho).not.toHaveProperty('posVenda')
    const pos = (await db.select().from(negocios)).filter(
      (n) => n.funilId === 'pos',
    )
    expect(pos).toHaveLength(1)
    expect(pos[0]).toMatchObject({ id: abrir.id, origemId: null })
    expect(
      await cmd(vendedor, {
        tipo: 'apagarContato',
        contatoId: 'a',
        conversas: 0,
        negocios: 2,
      }),
    ).toEqual(negar)
  } finally {
    await h.dispose()
  }
})

it('reconfere a confirmação, apaga os vínculos e retoma a limpeza após falha no R2 com uma única auditoria', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const { body } = await h.signIn('qa-gestora@exemplo.test')
    const usuarioId = body.user.id
    const id = randomUUID()
    await db.insert(numeros).values({
      id: 'linha',
      nome: 'Empresa',
      setorId: 'com',
      funilPadraoId: 'vendas',
      cor: '#0f766e',
    })
    const criado = await executarComando(db, h.env.BUCKET, usuarioId, {
      tipo: 'criarContato',
      id,
      nome: 'Cliente',
      telefone: '11 96666-5555',
      numeroId: 'linha',
    })
    if (!criado.ok || !criado.conversaId)
      throw new Error('O contato precisa de conversa.')
    const arquivo = 'midias/arquivo-do-contato'
    await h.env.BUCKET.put(arquivo, 'conteúdo exclusivo')
    await h.env.BUCKET.put('midias/outro', 'preservado')
    await db.insert(mensagens).values({
      id: 'm',
      conversaId: criado.conversaId,
      numeroId: 'linha',
      direcao: 'enviada',
      tipo: 'documento',
      estado: 'enviada',
      arquivoChave: arquivo,
      instante: new Date(),
    })
    // Mil e uma mídias adicionais: excede o máximo de 1000 chaves por pedido R2.
    await h.db
      .prepare(`WITH RECURSIVE serie(i) AS (
        SELECT 1 UNION ALL SELECT i+1 FROM serie WHERE i<1001
      ) INSERT INTO mensagens(id,conversa_id,numero_id,direcao,tipo,estado,arquivo_chave,instante)
      SELECT 'm-'||i,?,'linha','enviada','documento','enviada','midias/teste-'||i,0 FROM serie`)
      .bind(criado.conversaId)
      .run()
    await h.env.BUCKET.put('midias/teste-1001', 'outro documento do contato')
    await db.insert(notas).values({ id: 'n', contatoId: id, texto: 'privado' })
    await db.insert(retornos).values({
      id: 'r',
      contatoId: id,
      numeroId: 'linha',
      motivo: 'privado',
      marcadoPara: new Date(),
    })
    await executarComando(db, h.env.BUCKET, usuarioId, {
      tipo: 'abrirNegocio',
      id: randomUUID(),
      contatoId: id,
      funilId: 'vendas',
    })
    const apagar = {
      tipo: 'apagarContato' as const,
      contatoId: id,
      conversas: 1,
      negocios: 1,
    }
    expect(
      await executarComando(db, h.env.BUCKET, usuarioId, {
        ...apagar,
        negocios: 0,
      }),
    ).toMatchObject({ ok: false })
    expect(await h.env.BUCKET.head(arquivo)).toBeTruthy()
    await expect(
      executarComando(
        db,
        {
          delete: async () => {
            throw new Error('R2 indisponível')
          },
        },
        usuarioId,
        apagar,
      ),
    ).rejects.toThrow()
    const quantidadeNaFila = async () =>
      (await db.select({ n: count() }).from(arquivosEmExclusao))[0].n
    expect(await quantidadeNaFila()).toBe(1002)
    expect((await runJobs(h.env))['contatos.expurgar-arquivos']).toBe('ok')
    const restante = await quantidadeNaFila()
    expect(restante).toBeGreaterThan(0)
    expect(restante).toBeLessThan(1002)
    expect(await executarComando(db, h.env.BUCKET, usuarioId, apagar)).toEqual({
      ok: true,
      contatoId: id,
    })
    for (const tabela of [
      mensagens,
      conversas,
      negocios,
      notas,
      retornos,
      contatos,
    ]) {
      expect(await db.select().from(tabela)).toHaveLength(0)
    }
    expect(await h.env.BUCKET.head(arquivo)).toBeNull()
    expect(await h.env.BUCKET.head('midias/teste-1001')).toBeNull()
    expect(await quantidadeNaFila()).toBe(0)
    expect(await h.env.BUCKET.head('midias/outro')).toBeTruthy()
    const eventos = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'contato.apagado'))
    expect(eventos).toHaveLength(1)
    expect(eventos[0]).toMatchObject({
      actorId: usuarioId,
      createdAt: expect.any(Date),
      actorEmail: null,
      targetId: null,
      meta: null,
    })
  } finally {
    await h.dispose()
  }
})
