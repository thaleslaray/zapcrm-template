import { expect, it, vi } from 'vitest'
import { getDb } from '#/db'
import { numeros } from '#/db/schema'
import { createAuthHarness } from '#/test/auth-harness'
import { processarAviso } from './wa-avisos'

it('somente o complete novo do pedido de pareamento conclui e reconcilia o número', async () => {
  const h = await createAuthHarness()
  try {
    await h.signIn('qa-carga@exemplo.test')
    const db = getDb(h.db)
    await db.insert(numeros).values({
      id: 'linha',
      nome: 'Loja',
      setorId: 'com',
      funilPadraoId: 'vendas',
      cor: '#123',
      tokenCifrado: 'segredo-local',
      estado: 'conectado',
      sincronizandoHistorico: true,
    })
    const consultas: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const rota = new URL(String(input)).pathname
      consultas.push(rota)
      return Response.json({
        chats: [],
        messages: [],
        pagination: { hasMore: false },
      })
    })
    const aviso = (envelope: object) =>
      processarAviso(
        h.env,
        'linha',
        {
          endereco: 'http://localhost:3233',
          token: 'teste',
          vinculo: 'segredo-local',
        },
        { EventType: 'history', ...envelope },
      )
    const status = {
      event: 'status',
      batchHistoryStatus: 'complete',
      batchChunkOrder: 2,
    }
    const ler = () => db.select().from(numeros).get()
    await aviso({
      ...status,
      request_chat: '5511984213307@s.whatsapp.net',
      request_id: 'manual',
      status: 'timeout',
      has_more: null,
    })
    expect(await ler()).toMatchObject({
      sincronizandoHistorico: true,
      historicoPedido: null,
      historicoOrdem: 0,
    })
    await db.update(numeros).set({ historicoPedido: 'pareamento' })
    await aviso({
      ...status,
      request_id: 'pareamento-anterior',
      batchChunkOrder: 99,
    })
    await aviso({ ...status })
    expect(await ler()).toMatchObject({
      sincronizandoHistorico: true,
      historicoOrdem: 0,
    })
    await aviso({ ...status, request_id: 'pareamento' })
    await aviso({ ...status, request_id: 'pareamento' })
    expect(await ler()).toMatchObject({
      sincronizandoHistorico: false,
      historicoOrdem: -3,
    })
    expect(consultas.filter((rota) => rota.endsWith('/find'))).toEqual([
      '/chat/find',
      '/message/find',
    ])
  } finally {
    vi.restoreAllMocks()
    await h.dispose()
  }
})

it('aceita histórico de chamadas e etiquetas sem fila, e lotes manuais ou mistos não reabrem a carga', async () => {
  const { cifrarToken, hashSegredo } = await import('./uazapi')
  const { receberWebhook } = await import('./wa-avisos-receptor')
  const { avisosPendentes } = await import('#/db/schema')
  const h = await createAuthHarness({
    UAZAPI_URL: 'http://localhost:3233',
    UAZAPI_ADMIN_TOKEN: 'teste',
    UAZAPI_CHAVE: btoa('m'.repeat(32)),
  })
  try {
    await h.signIn('qa-lotes@exemplo.test')
    const db = getDb(h.db)
    const segredo = 's'.repeat(43)
    const token = 'token-apenas-local'
    await db.insert(numeros).values({
      id: 'linha',
      nome: 'Loja',
      setorId: 'com',
      funilPadraoId: 'vendas',
      cor: '#123',
      tokenCifrado: await cifrarToken(h.env.UAZAPI_CHAVE, token),
      segredoWebhookHash: await hashSegredo(segredo),
      historicoPedido: 'pareamento',
      historicoOrdem: -3,
    })
    const tarefas: Promise<unknown>[] = []
    const enviar = (corpo: object) =>
      receberWebhook(
        h.env,
        new Request(
          `http://localhost:3320/api/whatsapp/aviso/linha/${segredo}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ EventType: 'history', token, ...corpo }),
          },
        ),
        (p) => tarefas.push(p),
      )
    for (const evento of ['calls', 'labels', 'chat_labels']) {
      const resposta = await enviar({ event: evento, [evento]: [{ id: 123 }] })
      expect(resposta.status).toBe(200)
    }
    expect(tarefas).toHaveLength(0)
    expect(await db.select().from(avisosPendentes)).toEqual([])
    const message = {
      messageid: 'antes',
      chatid: '551189991234@s.whatsapp.net',
      messageTimestamp: 1700000000000,
      text: 'Anterior',
      request_id: 'manual',
    }
    for (const pedido of ['manual', undefined]) {
      await enviar({
        event: 'messages',
        request_id: pedido,
        messages: [message],
        batchChunkOrder: 15,
      })
      // O indicador também permanece desligado entre a recepção e o consumo.
      expect(await db.select().from(numeros).get()).toMatchObject({
        sincronizandoHistorico: false,
      })
      await Promise.all(tarefas)
      expect(await db.select().from(numeros).get()).toMatchObject({
        sincronizandoHistorico: false,
        historicoOrdem: -3,
      })
    }
  } finally {
    await h.dispose()
  }
})
