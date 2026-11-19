import { expect, it, vi } from 'vitest'
import { getDb } from '#/db'
import { contatos, conversas, numeros, pedidosHistorico } from '#/db/schema'
import { createAuthHarness } from '#/test/auth-harness'
import { cifrarToken } from './uazapi'
import { processarAviso } from './wa-avisos'
import { lerConversaComHistorico } from './wa-conversas'
import { pedirHistorico } from './wa-historico-manual'

it('a equipe acompanha um pedido por conversa e só pagina com a referência entregue para aquele pedido', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const gestor = (await h.signIn('qa-gestor@exemplo.test')).body.user.id
    const colega = (await h.signIn('qa-colega@exemplo.test')).body.user.id
    const chave = btoa('k'.repeat(32))
    const credencial = {
      endereco: 'http://127.0.0.1:3233',
      token: 'teste',
      vinculo: await cifrarToken(chave, 'teste'),
    }
    const vars = Object.assign(h.env, {
      UAZAPI_URL: credencial.endereco,
      UAZAPI_ADMIN_TOKEN: 'falso',
      UAZAPI_CHAVE: chave,
    })
    await db.insert(numeros).values({
      id: 'n',
      nome: 'Equipe',
      estadoEm: new Date(),
      estado: 'conectado',
      setorId: 'com',
      funilPadraoId: 'vendas',
      cor: 'verde',
      tokenCifrado: credencial.vinculo,
    })
    const jid = '5511987654321@s.whatsapp.net'
    await db.insert(contatos).values({ id: 'c', nome: 'Ana' })
    await db
      .insert(conversas)
      .values({ id: 'cv', contatoId: 'c', numeroId: 'n', jid })
    const pedidos: { requestId: string }[] = []
    let paginas = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const corpo = JSON.parse(String(init?.body))
      if (String(url).endsWith('/message/find')) {
        paginas++
        expect(corpo).toEqual({ chatid: jid, limit: 20, offset: 0 })
        return Response.json({
          messages: [
            {
              chatid: jid,
              messageid: 'M1',
              messageTimestamp: 1706350400000,
              text: 'Página guardada',
            },
          ],
        })
      }
      expect(String(url)).toBe(`${credencial.endereco}/message/history-sync`)
      pedidos.push(corpo)
      return Response.json({ request_id: corpo.requestId })
    })
    const pedir = (usuario = gestor) => pedirHistorico(db, vars, usuario, 'cv')
    const ler = () => lerConversaComHistorico(db, gestor, 'cv')
    const status = (request_id: string, resultado: object) =>
      processarAviso(h.env, 'n', credencial, {
        EventType: 'history',
        event: 'status',
        request_id,
        request_chat: jid,
        batchHistoryStatus: 'complete',
        batchChunkOrder: 1,
        ...resultado,
      })
    await expect(pedir(colega)).rejects.toThrow('Sem acesso')
    await Promise.all([pedir(), pedir()])
    expect(paginas).toBe(1)
    expect(pedidos).toHaveLength(1)
    expect(pedidos[0]).toMatchObject({ number: jid, count: 50 })
    await expect(ler()).resolves.toMatchObject({
      lista: [{ texto: 'Página guardada' }],
      historico: { estado: 'pendente' },
    })
    const proximo = {
      number: jid,
      count: 100,
      messageid: 'M1',
      timestamp: 1706350400000,
      fromMe: false,
    }
    await status('pedido-alheio', { status: 'completed', has_more: false })
    await expect(ler()).resolves.toMatchObject({
      historico: { estado: 'pendente' },
    })
    await status(pedidos[0].requestId, {
      status: 'completed',
      has_more: true,
      next_request: proximo,
    })
    await expect(ler()).resolves.toMatchObject({
      historico: { estado: 'mais' },
    })
    await pedir()
    expect(pedidos[1]).toEqual({ ...proximo, requestId: expect.any(String) })
    await status(pedidos[1].requestId, {
      status: 'completed',
      has_more: false,
      next_request: null,
    })
    await expect(ler()).resolves.toMatchObject({
      historico: { estado: 'inicio' },
    })
    await pedir()
    expect(pedidos).toHaveLength(2)
  } finally {
    vi.restoreAllMocks()
    await h.dispose()
  }
})

it('um status final sem o chat opcional resolve apenas o identificador reservado no número', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const gestor = (await h.signIn('qa-gestor@exemplo.test')).body.user.id
    const credencial = {
      endereco: 'http://localhost:3233',
      token: 'local',
      vinculo: 'cifra-testada',
    }
    await db.insert(numeros).values({
      id: 'n',
      nome: 'Loja',
      cor: 'verde',
      estadoEm: new Date(),
      setorId: 'com',
      funilPadraoId: 'vendas',
      tokenCifrado: credencial.vinculo,
    })
    for (const [estado, resultado] of [
      ['expirado', { status: 'timeout', has_more: null }],
      [
        'inacessivel',
        { status: 'completed', history_access: 'unavailable', has_more: true },
      ],
      [
        'bloqueado',
        { status: 'blocked', error: 'pagination_no_progress', has_more: true },
      ],
      [
        'inconclusivo',
        { status: 'completed', has_more: null, next_request: null },
      ],
    ] as const) {
      const id = estado
      await db.insert(contatos).values({ id, nome: 'Contato' })
      await db.insert(conversas).values({
        id,
        contatoId: id,
        numeroId: 'n',
        lid: `identidade.${id}@lid`,
      })
      await db.insert(pedidosHistorico).values({
        conversaId: id,
        pedidoId: id,
        estado: 'pendente',
        iniciadoEm: Date.now(),
      })
      await processarAviso(h.env, 'n', credencial, {
        EventType: 'history',
        event: 'status',
        batchHistoryStatus: 'complete',
        request_id: id,
        ...resultado,
      })
      await expect(
        lerConversaComHistorico(db, gestor, id),
      ).resolves.toMatchObject({
        historico: {
          estado,
          motivo: estado === 'bloqueado' ? 'pagination_no_progress' : null,
        },
      })
    }
  } finally {
    await h.dispose()
  }
})

it('uma âncora apagada encerra a tentativa sem expor o erro bruto ou reenviar o mesmo corpo', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const gestor = (await h.signIn('qa-gestor@exemplo.test')).body.user.id
    const vars = Object.assign(h.env, {
      UAZAPI_URL: 'http://127.0.0.1:3233',
      UAZAPI_ADMIN_TOKEN: 'falso',
      UAZAPI_CHAVE: btoa('k'.repeat(32)),
    })
    await db.insert(numeros).values({
      id: 'n',
      nome: 'Loja',
      cor: 'verde',
      estadoEm: new Date(),
      setorId: 'com',
      funilPadraoId: 'vendas',
      tokenCifrado: await cifrarToken(vars.UAZAPI_CHAVE, 'teste'),
    })
    await db.insert(contatos).values({ id: 'c', nome: 'Contato' })
    const lid = 'identidade.opaca-9@lid'
    await db
      .insert(conversas)
      .values({ id: 'cv', contatoId: 'c', numeroId: 'n', lid })
    await db.insert(pedidosHistorico).values({
      conversaId: 'cv',
      pedidoId: 'anterior',
      estado: 'mais',
      iniciadoEm: Date.now(),
      proximo: {
        number: lid,
        count: 100,
        messageid: 'apagada',
        timestamp: 1706350400000,
        fromMe: false,
      },
    })
    const chamadas = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        {
          status: 'anchor_unavailable',
          error: 'anchor_unavailable',
          descricao: 'conteúdo privado do provedor',
        },
        { status: 400 },
      ),
    )
    await pedirHistorico(db, vars, gestor, 'cv')
    await expect(
      lerConversaComHistorico(db, gestor, 'cv'),
    ).resolves.toMatchObject({
      historico: { estado: 'bloqueado', motivo: 'anchor_unavailable' },
    })
    await pedirHistorico(db, vars, gestor, 'cv')
    // Uma releitura da conversa e um pedido ao celular; o bloqueio não repete nenhum dos dois.
    expect(chamadas).toHaveBeenCalledTimes(2)
  } finally {
    vi.restoreAllMocks()
    await h.dispose()
  }
})
