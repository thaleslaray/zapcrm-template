import { expect, it, vi } from 'vitest'
import { getDb } from '#/db'
import { contatos, conversas, mensagens, negocios, numeros } from '#/db/schema'
import { createAuthHarness } from '#/test/auth-harness'
import { processarAviso } from './wa-avisos'

const credencial = {
  endereco: 'http://localhost:3233',
  token: 'teste',
  vinculo: 'cifra-da-linha',
}

it('dois avisos simultâneos da mesma mensagem abrem um único atendimento e contam uma não lida', async () => {
  const h = await createAuthHarness()
  try {
    await h.signIn('qa-atendimento@exemplo.test')
    const db = getDb(h.db)
    await db.insert(numeros).values({
      id: 'linha',
      nome: 'Loja',
      tokenCifrado: credencial.vinculo,
      setorId: 'com',
      funilPadraoId: 'vendas',
      cor: '#0f766e',
    })
    const mensagem = {
      messageid: 'A01',
      chatid: '5511984213307@s.whatsapp.net',
      messageTimestamp: 1700000000000,
      senderName: 'Clara',
      messageType: 'Conversation',
      text: 'Bom dia',
    }
    const aviso = { EventType: 'messages', message: mensagem }
    await Promise.all([
      processarAviso(h.env, 'linha', credencial, aviso),
      processarAviso(h.env, 'linha', credencial, aviso),
    ])
    expect(await db.select().from(contatos)).toMatchObject([{ nome: 'Clara' }])
    expect(await db.select().from(conversas)).toMatchObject([{ naoLidas: 1 }])
    expect(await db.select().from(negocios)).toMatchObject([
      { etapaId: 'novo' },
    ])
    expect(await db.select().from(mensagens)).toMatchObject([
      { identificador: 'A01', texto: 'Bom dia' },
    ])
  } finally {
    await h.dispose()
  }
})

it('a leitura pode chegar antes do eco; lotes antigos repetidos não abrem negócio e só o último lote encerra a carga', async () => {
  const h = await createAuthHarness()
  try {
    await h.signIn('qa-atendimento@exemplo.test')
    const db = getDb(h.db)
    await db.insert(numeros).values({
      id: 'linha',
      nome: 'Loja',
      historicoPedido: 'pareamento',
      tokenCifrado: credencial.vinculo,
      setorId: 'com',
      funilPadraoId: 'vendas',
      cor: '#0f766e',
    })
    const chatid = '5511984213307@s.whatsapp.net'
    const aviso = (dados: object) =>
      processarAviso(h.env, 'linha', credencial, dados)
    const historico = {
      EventType: 'history',
      event: 'messages',
      request_id: 'pareamento',
      batchChunkOrder: 2,
      messages: [
        {
          messageid: 'A03',
          chatid,
          messageTimestamp: 1700000003000,
          text: 'Terceira',
        },
        {
          messageid: 'A01',
          chatid,
          messageTimestamp: 1700000001000,
          text: 'Primeira',
        },
        {
          messageid: 'A02',
          chatid,
          messageTimestamp: 1700000002000,
          text: 'Segunda',
        },
        {
          messageid: 'Grupo',
          chatid: '332@g.us',
          messageTimestamp: 1700000000000,
          text: 'Grupo',
        },
      ],
    }
    await aviso(historico)
    await aviso(historico)
    expect(await db.select().from(conversas)).toMatchObject([{ naoLidas: 0 }])
    expect(await db.select().from(negocios)).toHaveLength(0)
    expect(
      (await db.select().from(mensagens).orderBy(mensagens.instante)).map(
        (m) => m.texto,
      ),
    ).toEqual(['Primeira', 'Segunda', 'Terceira'])
    const fim = {
      EventType: 'history',
      event: 'status',
      request_id: 'pareamento',
      batchHistoryStatus: 'complete',
    }
    await aviso({ ...fim, batchChunkOrder: 1 })
    expect(await db.select().from(numeros)).toMatchObject([
      { sincronizandoHistorico: true },
    ])
    await aviso({ ...fim, batchChunkOrder: 2 })
    await aviso(historico)
    expect(await db.select().from(numeros)).toMatchObject([
      { sincronizandoHistorico: false },
    ])
    const [conversa] = await db.select().from(conversas)
    await db.insert(mensagens).values({
      id: 'nossa',
      conversaId: conversa.id,
      numeroId: 'linha',
      direcao: 'enviada',
      tipo: 'texto',
      estado: 'fila',
      texto: 'Oi',
      instante: new Date(),
    })
    const recibo = {
      EventType: 'messages_update',
      type: 'ReadReceipt',
      state: 'Read',
      event: { MessageIDs: ['SAIDA'], chatid },
    }
    await aviso(recibo)
    await aviso({ ...recibo, state: 'Delivered' })
    await aviso({
      EventType: 'messages',
      message: {
        messageid: 'SAIDA',
        id: '5533000000:SAIDA',
        fromMe: true,
        track_source: 'zapcrm',
        track_id: 'nossa',
        text: 'Oi',
        chatid,
        messageTimestamp: 1700000005000,
      },
    })
    expect(await db.select().from(mensagens)).toHaveLength(4)
    expect(
      (await db.select().from(mensagens)).find((m) => m.id === 'nossa'),
    ).toMatchObject({ identificador: 'SAIDA', estado: 'lida' })
  } finally {
    await h.dispose()
  }
})

it('importa uma página de histórico em lote, sem uma viagem ao D1 para cada mensagem', async () => {
  const h = await createAuthHarness()
  try {
    await h.signIn('qa-atendimento@exemplo.test')
    await getDb(h.db).insert(numeros).values({
      id: 'linha',
      nome: 'Loja',
      tokenCifrado: credencial.vinculo,
      setorId: 'com',
      funilPadraoId: 'vendas',
      cor: '#123',
    })
    const { medirFila } = await import('#/test/d1-fila')
    const { gravarHistorico } = await import('./wa-avisos')
    const mensagens = Array.from({ length: 40 }, (_, i) => ({
      messageid: String(i),
      chatid: '5511984213307@s.whatsapp.net',
      messageTimestamp: 1700000000000 + i,
      text: 'Histórico',
    }))
    const { total } = await medirFila(
      h.db,
      () => gravarHistorico(h.env, 'linha', credencial, mensagens),
      1,
    )
    expect(total).toBeLessThanOrEqual(2)
  } finally {
    await h.dispose()
  }
})

it('repetir a conexão retoma uma reconciliação interrompida depois de o número já aparecer conectado', async () => {
  const h = await createAuthHarness({ UAZAPI_URL: 'http://localhost:3233' })
  try {
    await h.signIn('qa-atendimento@exemplo.test')
    const db = getDb(h.db)
    await db.insert(numeros).values({
      id: 'linha',
      nome: 'Loja',
      tokenCifrado: credencial.vinculo,
      setorId: 'com',
      funilPadraoId: 'vendas',
      cor: '#123',
    })
    const evento = {
      EventType: 'connection',
      instance: { status: 'connected' },
    }
    let interrompido = true
    const recuperada = {
      messageid: 'recuperada',
      chatid: '5511984213307@s.whatsapp.net',
      messageTimestamp: 1700000000000,
      text: 'Mensagem recuperada',
    }
    const consultas: (string | number)[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      switch (new URL(String(input)).pathname) {
        case '/instance/status':
          return Response.json({ instance: { status: 'connected' } })
        case '/webhook/errors':
          return init?.method === 'GET'
            ? Response.json([{ event: 'messages', messageid: 'recuperada' }])
            : new Response(null, { status: 405 })
        case '/chat/find':
          return Response.json({ chats: [], pagination: { hasMore: false } })
        case '/message/find': {
          const busca = JSON.parse(String(init?.body))
          consultas.push(busca.id ?? busca.offset)
          if (busca.id) return Response.json({ messages: [recuperada] })
          if (interrompido) return new Response(null, { status: 503 })
          return Response.json(
            busca.offset === 0
              ? {
                  messages: [recuperada],
                  pagination: { hasMore: true, nextOffset: 1 },
                }
              : {
                  messages: [{ ...recuperada, messageid: 'anterior' }],
                  pagination: { hasMore: false },
                },
          )
        }
        default:
          return new Response(null, { status: 404 })
      }
    })
    await processarAviso(h.env, 'linha', credencial, evento)
    await expect(
      processarAviso(h.env, 'linha', credencial, evento),
    ).rejects.toThrow()
    expect(await db.select().from(numeros)).toMatchObject([
      { estado: 'conectado' },
    ])
    interrompido = false
    await processarAviso(h.env, 'linha', credencial, evento)
    await processarAviso(h.env, 'linha', credencial, evento)
    expect(consultas).toEqual(['recuperada', 0, 0, 1])
    expect(await db.select().from(mensagens)).toHaveLength(2)
    expect(await db.select().from(conversas)).toMatchObject([{ naoLidas: 1 }])
  } finally {
    vi.restoreAllMocks()
    await h.dispose()
  }
})

it('a reconciliação conclui pela varredura quando o servidor recusa a consulta de falhas de webhook', async () => {
  const h = await createAuthHarness({ UAZAPI_URL: 'http://localhost:3233' })
  try {
    await h.signIn('qa-atendimento@exemplo.test')
    const db = getDb(h.db)
    await db.insert(numeros).values({
      id: 'linha',
      nome: 'Loja',
      tokenCifrado: credencial.vinculo,
      setorId: 'com',
      funilPadraoId: 'vendas',
      cor: '#123',
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      switch (new URL(String(input)).pathname) {
        case '/instance/status':
          return Response.json({ instance: { status: 'connected' } })
        case '/chat/find':
          return Response.json({ chats: [], pagination: { hasMore: false } })
        case '/message/find':
          return Response.json({
            messages: [
              {
                messageid: 'guardada',
                chatid: '5511984213307@s.whatsapp.net',
                messageTimestamp: 1700000000000,
                text: 'Mensagem guardada',
              },
            ],
            pagination: { hasMore: false },
          })
        default:
          return new Response(null, { status: 404 })
      }
    })
    await processarAviso(h.env, 'linha', credencial, {
      EventType: 'connection',
      instance: { status: 'connected' },
    })
    expect(await db.select().from(mensagens)).toHaveLength(1)
  } finally {
    vi.restoreAllMocks()
    await h.dispose()
  }
})

it('a edição substitui o texto da mensagem original e não vira outra mensagem', async () => {
  const h = await createAuthHarness()
  try {
    await h.signIn('qa-atendimento@exemplo.test')
    const db = getDb(h.db)
    await db.insert(numeros).values({
      id: 'linha',
      nome: 'Loja',
      tokenCifrado: credencial.vinculo,
      setorId: 'com',
      funilPadraoId: 'vendas',
      cor: '#123',
    })
    const base = {
      chatid: '5511984213307@s.whatsapp.net',
      senderName: 'Clara',
      messageType: 'Conversation',
    }
    const original = {
      ...base,
      messageid: 'ORIGINAL',
      messageTimestamp: 1700000000000,
      text: 'Bom dia. Texto longo que será cortado.',
    }
    const edicao = {
      ...base,
      messageid: 'EDICAO',
      edited: 'ORIGINAL',
      messageTimestamp: 1700000005000,
      text: 'Bom dia.',
    }
    await processarAviso(h.env, 'linha', credencial, {
      EventType: 'messages',
      message: original,
    })
    await processarAviso(h.env, 'linha', credencial, {
      EventType: 'messages',
      message: edicao,
    })
    // Repetir a entrega, como numa nova sincronização, mantém uma mensagem só.
    await processarAviso(h.env, 'linha', credencial, {
      EventType: 'messages',
      message: edicao,
    })
    expect(await db.select().from(mensagens)).toMatchObject([
      { identificador: 'ORIGINAL', texto: 'Bom dia.', editada: true },
    ])
    expect(await db.select().from(conversas)).toMatchObject([{ naoLidas: 1 }])
  } finally {
    await h.dispose()
  }
})
