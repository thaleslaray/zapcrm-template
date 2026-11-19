import { expect, test, vi } from 'vitest'
import { autenticarAviso, cifrarToken, hashSegredo } from './uazapi'

test('só o par de credenciais do mesmo número autoriza um aviso', async () => {
  const chave = btoa('k'.repeat(32))
  const numero = {
    tokenCifrado: await cifrarToken(chave, 'token-do-numero'),
    segredoWebhookHash: await hashSegredo('segredo-do-endereco'),
  }
  expect(numero.tokenCifrado).not.toContain('token-do-numero')
  expect(
    await autenticarAviso(
      chave,
      numero,
      'segredo-do-endereco',
      'token-do-numero',
    ),
  ).toBe(true)
  expect(
    await autenticarAviso(chave, numero, 'outro-endereco', 'token-do-numero'),
  ).toBe(false)
  expect(
    await autenticarAviso(chave, numero, 'segredo-do-endereco', 'outro-token'),
  ).toBe(false)
})

test.each([
  ['/instance/create', 429, null, 'O servidor atingiu o limite de instâncias.'],
  [
    '/instance/connect',
    429,
    '17',
    'O servidor uazapi recusou a conexão: o limite de números conectados do plano foi atingido. Confira o plano no painel da uazapi. Tente novamente em 17 segundos.',
  ],
  [
    '/instance/connect',
    503,
    '1',
    'A conexão está temporariamente indisponível. Tente novamente em 1 segundo.',
  ],
  [
    '/instance/connect',
    429,
    'conteudo-privado',
    'O servidor uazapi recusou a conexão: o limite de números conectados do plano foi atingido. Confira o plano no painel da uazapi.',
  ],
] as const)(
  'explica a recusa em %s (%i, prazo %s)',
  async (rota, status, prazo, mensagem) => {
    const { chamarInstancia, chamarAdministracao } = await import('./uazapi')
    const resposta = new Response('conteudo-privado', {
      status,
      headers: prazo ? { 'Retry-After': prazo } : {},
    })
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta)
    try {
      const chamar =
        rota === '/instance/create' ? chamarAdministracao : chamarInstancia
      await expect(
        chamar('http://localhost:3233', 'teste', rota, {}),
      ).rejects.toMatchObject({ message: mensagem })
      expect(fetch).toHaveBeenCalledTimes(1)
    } finally {
      fetch.mockRestore()
    }
  },
)
