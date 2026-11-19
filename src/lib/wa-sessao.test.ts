import { expect, it, vi } from 'vitest'
import { enviarTextoFn } from './wa-conversas-fns'
import {
  conectarNumeroFn,
  consultarPareamentoFn,
  desconectarNumeroFn,
} from './wa-numeros-fns'

const getSession = vi.hoisted(() => vi.fn().mockResolvedValue(null))
vi.mock('./auth', () => ({ getAuth: () => ({ api: { getSession } }) }))
vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => new Request('https://exemplo.test/app'),
}))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    validator() {
      return this
    },
    handler: (handler: unknown) => handler,
  }),
}))

it('consulta a sessão sem cache antes de enviar texto, parear, consultar o código ou desconectar', async () => {
  const chamadas = [
    () =>
      enviarTextoFn({
        data: {
          id: crypto.randomUUID(),
          texto: 'Oi',
          conversaId: 'c',
          repetir: false,
        },
      }),
    () => conectarNumeroFn({ data: { id: 'n', dias: 0, telefone: undefined } }),
    () => consultarPareamentoFn({ data: 'n' }),
    () => desconectarNumeroFn({ data: 'n' }),
  ]
  for (const chamar of chamadas) {
    await expect(chamar()).rejects.toThrow()
    expect(getSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ disableCookieCache: true }),
      }),
    )
  }
})
