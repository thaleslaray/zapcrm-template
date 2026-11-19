import { expect, it, vi } from 'vitest'
import { getDb } from '#/db'
import { runWithD1Session } from '#/db/d1-session'
import { numeros } from '#/db/schema'
import { createAuthHarness } from '#/test/auth-harness'
import { cifrarToken } from './uazapi'
import { desconectarNumero } from './wa-numeros-gestao'

it('usa o papel do primário para autorizar a desconexão mesmo com réplica indisponível', async () => {
  const h = await createAuthHarness({
    UAZAPI_URL: 'http://localhost:3233',
    UAZAPI_ADMIN_TOKEN: 'admin-local',
    UAZAPI_CHAVE: btoa('x'.repeat(32)),
  })
  try {
    const gestora = (await h.signIn('gestora@exemplo.test')).body.user.id
    await getDb(h.db)
      .insert(numeros)
      .values({
        id: 'linha',
        nome: 'Loja',
        setorId: 'com',
        funilPadraoId: 'vendas',
        cor: '#123',
        estadoEm: new Date(),
        estado: 'conectado',
        segredoWebhookHash: 'local',
        tokenCifrado: await cifrarToken(h.env.UAZAPI_CHAVE, 'local'),
      })
    const rede = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () =>
        Response.json({ instance: { status: 'connected' } }),
      )
    await runWithD1Session(
      {
        prepare: () => {
          throw new Error('Réplica indisponível.')
        },
        batch: () => {
          throw new Error('Réplica indisponível.')
        },
        getBookmark: () => null,
      },
      () => desconectarNumero(h.env, gestora, 'linha'),
    )
    expect(
      rede.mock.calls.map(([url]) => new URL(String(url)).pathname),
    ).toContain('/instance/disconnect')
  } finally {
    vi.restoreAllMocks()
    await h.dispose()
  }
})
