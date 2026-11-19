import { expect, it, vi } from 'vitest'
import { TempoRealSetor } from './tempo-real-setor'

vi.mock('cloudflare:workers', async (importar) => ({
  ...(await importar<typeof import('cloudflare:workers')>()),
  DurableObject: class {},
}))

it.each([
  { pessoa: 8, setor: 12 },
  { pessoa: 1, setor: 256 },
])(
  'recusa uma abertura excedente com $pessoa conexões da pessoa e $setor no setor',
  ({ pessoa, setor }) => {
    const pedido = new Request('https://setor.internal/', {
      headers: {
        upgrade: 'websocket',
        'x-sessao': 'sessao',
        'x-usuario': 'ana',
      },
    })
    const ctx = {
      getWebSockets: (tag?: string) =>
        new Array(tag === 'usuario:ana' ? pessoa : setor),
      acceptWebSocket: vi.fn(),
    }
    vi.stubGlobal(
      'WebSocketPair',
      class {
        constructor() {
          throw new Error('Tentou abrir uma conexão além do limite.')
        }
      },
    )
    try {
      expect(
        Reflect.apply(TempoRealSetor.prototype.fetch, { ctx }, [pedido]).status,
      ).toBe(429)
      expect(ctx.acceptWebSocket).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  },
)

it('revalida a sessão de sockets novos e legados qualquer que seja a ordem das tags', async () => {
  const acesso = await import('./tempo-real-acesso')
  const autorizacao = vi
    .spyOn(acesso, 'sessoesDoSetor')
    .mockResolvedValue(new Set(['atual', 'legada', 'transicao']))
  const conexoes = [
    {
      tags: ['usuario:ana', 'sessao:atual'],
      readyState: WebSocket.OPEN,
      send: vi.fn(),
      close: vi.fn(),
    },
    {
      tags: ['legada'],
      readyState: WebSocket.OPEN,
      send: vi.fn(),
      close: vi.fn(),
    },
    {
      tags: ['usuario:ana', 'transicao'],
      readyState: WebSocket.OPEN,
      send: vi.fn(),
      close: vi.fn(),
    },
    {
      tags: ['usuario:ana'],
      readyState: WebSocket.OPEN,
      send: vi.fn(),
      close: vi.fn(),
    },
  ]
  const ctx = {
    id: { name: 'com' },
    getWebSockets: () => conexoes,
    getTags: (s: (typeof conexoes)[number]) => s.tags,
  }
  try {
    await Reflect.apply(TempoRealSetor.prototype.avisar, { ctx, env: {} }, [])
    for (const socket of conexoes.slice(0, 3))
      expect(socket.send).toHaveBeenCalledWith('mudou')
    expect(conexoes[3].close).toHaveBeenCalledWith(1008, 'Sem acesso')
  } finally {
    autorizacao.mockRestore()
  }
})
