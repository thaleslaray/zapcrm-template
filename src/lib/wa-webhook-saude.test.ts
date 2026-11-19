import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getDb } from '#/db'
import { mensagens, numeros } from '#/db/schema'
import { createAuthHarness } from '#/test/auth-harness'
import { runJobs } from './jobs'
import { cifrarToken, hashSegredo } from './uazapi'
import { reconciliarNumeroDoDia } from './wa-webhook-saude'

const origem = 'http://localhost:3310'
const segredo = 's'.repeat(43)
let h: Awaited<ReturnType<typeof createAuthHarness>>

beforeEach(async () => {
  h = await createAuthHarness({
    UAZAPI_CHAVE: btoa('s'.repeat(32)),
    UAZAPI_URL: 'http://localhost:3233',
    UAZAPI_ADMIN_TOKEN: 'local',
  })
  await h.signIn('gestor@exemplo.test')
  h.env.BETTER_AUTH_URL = origem
})
afterEach(async () => {
  vi.restoreAllMocks()
  await h.dispose()
})

async function adicionar(
  id: string,
  estado: 'conectado' | 'desconectado' = 'conectado',
) {
  await getDb(h.db)
    .insert(numeros)
    .values({
      id,
      nome: id,
      estado,
      cor: '#123',
      setorId: 'com',
      funilPadraoId: 'vendas',
      tokenCifrado: await cifrarToken(h.env.UAZAPI_CHAVE, id),
      segredoWebhookHash: await hashSegredo(segredo),
    })
}

it.each([origem, ''])(
  'o cron religa só o webhook do CRM e recupera o histórico da queda uma vez (origem %j)',
  async (endereco) => {
    h.env.BETTER_AUTH_URL = endereco
    await adicionar('loja')
    await adicionar('loja-desligada', 'desconectado')
    const url = `${origem}/api/whatsapp/aviso/loja/${segredo}`
    const webhook = {
      id: 'gancho-da-loja',
      url,
      enabled: false,
      events: ['messages'],
      health: { status: 'disabled' },
    }
    const salvos: object[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const rota = new URL(String(input)).pathname
      expect(new Headers(init?.headers).get('token')).toBe('loja')
      if (rota === '/webhook' && init?.method === 'GET')
        return Response.json([
          {
            ...webhook,
            id: 'outro',
            url: url.replace('localhost', 'outro.exemplo.test'),
          },
          webhook,
        ])
      if (rota === '/webhook' && init?.method === 'POST') {
        salvos.push(JSON.parse(String(init.body)))
        webhook.enabled = true
        webhook.health.status = 'unknown'
        return Response.json([webhook])
      }
      if (rota === '/webhook/errors') return Response.json([])
      if (rota === '/chat/find')
        return Response.json({ chats: [], pagination: { hasMore: false } })
      if (rota === '/message/find')
        return Response.json({
          messages: [
            {
              messageid: 'durante-a-queda',
              messageTimestamp: 1700000000000,
              chatid: '5511977891234@s.whatsapp.net',
              text: 'Mensagem da queda',
            },
          ],
          pagination: { hasMore: false },
        })
      return new Response(null, { status: 404 })
    })
    await runJobs(h.env)
    await reconciliarNumeroDoDia(h.env)
    await runJobs(h.env)
    await reconciliarNumeroDoDia(h.env)
    expect(salvos).toEqual([
      expect.objectContaining({
        action: 'update',
        id: webhook.id,
        enabled: true,
        url,
      }),
    ])
    expect(
      await getDb(h.db).select({ texto: mensagens.texto }).from(mensagens),
    ).toEqual([{ texto: 'Mensagem da queda' }])
  },
)

it('o teto deixa os números ainda sem consulta para o lote seguinte e respeita os estados da saúde', async () => {
  const estados = [
    'disabled',
    'failing',
    'slow',
    'very_slow',
    'ok',
    'unknown',
    'novo',
  ]
  for (const id of estados) await adicionar(id)
  const consultados: string[] = []
  const reativados: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const rota = new URL(String(input)).pathname
    const id = new Headers(init?.headers).get('token') ?? ''
    if (rota === '/webhook' && init?.method === 'GET') {
      consultados.push(id)
      return Response.json([
        {
          id,
          enabled: true,
          url: `${origem}/api/whatsapp/aviso/${id}/${segredo}`,
          events: ['messages'],
          health: { status: id },
        },
      ])
    }
    if (rota === '/webhook') {
      reativados.push(id)
      return Response.json([])
    }
    if (rota === '/webhook/errors') return Response.json([])
    if (rota === '/chat/find')
      return Response.json({ chats: [], pagination: { hasMore: false } })
    if (rota === '/message/find')
      return Response.json({ messages: [], pagination: { hasMore: false } })
    return new Response(null, { status: 404 })
  })
  await runJobs(h.env)
  expect(consultados).toHaveLength(5)
  const hoje = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(hoje + 86_400_000)
  await runJobs(h.env)
  expect(consultados).toHaveLength(10)
  expect(new Set(consultados)).toEqual(new Set(estados))
  expect(new Set(reativados)).toEqual(
    new Set(['disabled', 'failing', 'slow', 'very_slow']),
  )
})

it('o cron retoma uma varredura interrompida depois de salvar o webhook', async () => {
  await adicionar('loja')
  const webhook = {
    id: 'loja',
    url: `${origem}/api/whatsapp/aviso/loja/${segredo}`,
    enabled: true,
    events: ['messages'],
    health: { status: 'failing' },
  }
  let salvos = 0
  let buscas = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const rota = new URL(String(input)).pathname
    if (rota === '/webhook' && init?.method === 'GET')
      return Response.json([webhook])
    if (rota === '/webhook') {
      salvos++
      webhook.health.status = 'ok'
      return Response.json([webhook])
    }
    if (rota === '/webhook/errors') return Response.json([])
    if (rota === '/chat/find')
      return Response.json({ chats: [], pagination: { hasMore: false } })
    if (rota === '/message/find') {
      if (++buscas === 1) return new Response(null, { status: 503 })
      return Response.json({
        messages: [
          {
            messageid: 'pendente',
            messageTimestamp: 1700000000000,
            chatid: '5511977891234@s.whatsapp.net',
            text: 'Recuperada',
          },
        ],
        pagination: { hasMore: false },
      })
    }
    return new Response(null, { status: 404 })
  })
  await runJobs(h.env)
  await expect(reconciliarNumeroDoDia(h.env)).rejects.toThrow()
  const hoje = Date.now()
  const relogio = vi.spyOn(Date, 'now').mockReturnValue(hoje + 86_400_000)
  await runJobs(h.env)
  await reconciliarNumeroDoDia(h.env)
  relogio.mockReturnValue(hoje + 2 * 86_400_000)
  await runJobs(h.env)
  await reconciliarNumeroDoDia(h.env)
  expect(salvos).toBe(1)
  expect(buscas).toBe(3)
  expect(
    await getDb(h.db).select({ texto: mensagens.texto }).from(mensagens),
  ).toEqual([{ texto: 'Recuperada' }])
})
