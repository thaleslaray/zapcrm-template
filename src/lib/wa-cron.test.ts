import { afterEach, expect, it, vi } from 'vitest'
import { getDb } from '#/db'
import { mensagens, numeros } from '#/db/schema'
import { createAuthHarness } from '#/test/auth-harness'
import { medirFila } from '#/test/d1-fila'
import { cifrarToken } from './uazapi'

// O entry HTTP e o DO não participam do evento scheduled no workerd.
vi.mock('@tanstack/react-start/server-entry', () => ({ default: {} }))
vi.mock('#/lib/tempo-real-setor', () => ({ TempoRealSetor: class {} }))

import worker from '#/server'

afterEach(() => vi.restoreAllMocks())

it('o handler diário separa a varredura dos expurgos e da verificação dos webhooks', async () => {
  const h = await createAuthHarness({
    UAZAPI_CHAVE: btoa('x'.repeat(32)),
    UAZAPI_URL: 'http://localhost:3233',
    UAZAPI_ADMIN_TOKEN: 'local',
  })
  try {
    await h.signIn('gestora@exemplo.test')
    await getDb(h.db)
      .insert(numeros)
      .values({
        id: 'teste-cron',
        nome: 'Teste',
        estado: 'conectado',
        cor: '#123',
        setorId: 'com',
        funilPadraoId: 'vendas',
        tokenCifrado: await cifrarToken(h.env.UAZAPI_CHAVE, 'local'),
        segredoWebhookHash: 'local',
      })
    const rotas: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const rota = new URL(String(url)).pathname
      rotas.push(rota)
      if (rota === '/webhook' || rota === '/webhook/errors')
        return Response.json([])
      const jid = (i: number) =>
        `551198421${String(i).padStart(4, '0')}@s.whatsapp.net`
      if (rota === '/chat/find')
        return Response.json({
          chats: Array.from({ length: 45 }, (_, i) => ({ wa_chatid: jid(i) })),
          pagination: { hasMore: false },
        })
      if (rota === '/message/find')
        return Response.json({
          messages: Array.from({ length: 3 }, (_, i) => ({
            messageid: `cron-${i}`,
            chatid: jid(i),
            text: 'Mensagem diária',
            messageTimestamp: 1700000000000,
          })),
          pagination: { hasMore: false },
        })
      throw new Error('Rota inesperada.')
    })
    async function disparar(cron: string) {
      const tarefas: Promise<unknown>[] = []
      await worker.scheduled({ cron } as ScheduledController, h.env, {
        waitUntil: (p: Promise<unknown>) => tarefas.push(p),
      } as unknown as ExecutionContext)
      await Promise.all(tarefas)
    }
    await disparar('0 3 * * *')
    expect(rotas).toEqual(['/webhook'])
    rotas.length = 0
    const medicao = await medirFila(h.db, () => disparar('5 3 * * *'), 0)
    const sql = medicao.consultas.reduce(
      (s, q) => s + Number(/^batch\((\d+)\)/.exec(q)?.[1] ?? 1),
      0,
    )
    expect(sql).toBeLessThanOrEqual(16)
    console.info(
      `[c5] cron com 45 chats e 3 mensagens: D1=${medicao.total} idas/${sql} instruções; HTTP=${rotas.length}`,
    )
    expect(rotas).toEqual(['/webhook/errors', '/chat/find', '/message/find'])
    expect(await getDb(h.db).select().from(mensagens)).toHaveLength(3)
  } finally {
    await h.dispose()
  }
})
