import { env } from 'cloudflare:workers'
import { expect, it, vi } from 'vitest'
import { getDb } from '#/db'
import { createAuthHarness, ORIGIN } from '#/test/auth-harness'
import { closeAccountFn } from './account-fns'
import { alterarEquipe } from './equipe'

const { getRequest } = vi.hoisted(() => ({ getRequest: vi.fn() }))
vi.mock('@tanstack/react-start/server', async (importar) => ({
  ...(await importar<typeof import('@tanstack/react-start/server')>()),
  getRequest,
}))
vi.mock('@tanstack/react-start', async (importar) => ({
  ...(await importar<typeof import('@tanstack/react-start')>()),
  createServerFn: () => ({ handler: (handler: unknown) => handler }),
}))

it('preserva a conta e as sessões no encerramento quando a outra gestora saiu da lista', async () => {
  const h = await createAuthHarness({
    ACCESS_ALLOWLIST: 'ana@exemplo.test,bia@exemplo.test',
  })
  try {
    const ana = await h.signIn('ana@exemplo.test'),
      bia = await h.signIn('bia@exemplo.test')
    await alterarEquipe(
      getDb(h.db),
      ana.body.user.id,
      {
        tipo: 'editarPessoa',
        id: bia.body.user.id,
        papel: 'gestor',
        setores: [],
      },
      ORIGIN,
    )
    Object.assign(env, { ACCESS_ALLOWLIST: 'ana@exemplo.test' })
    const request = new Request(ORIGIN, { headers: { cookie: ana.cookie } })
    getRequest.mockReturnValue(request)
    await expect(closeAccountFn()).rejects.toThrow('pelo menos um gestor')
    expect(
      (
        await h.getAuth(request).api.getSession({
          headers: request.headers,
          query: { disableCookieCache: true },
        })
      )?.user.id,
    ).toBe(ana.body.user.id)
  } finally {
    await h.dispose()
  }
})
