import { QueryClient } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { invalidarNumeros } from './wa-numeros-queries'

vi.mock('./wa-numeros-fns', () => ({}))

it('adicionar um número atualiza as opções da estrutura e da carteira', async () => {
  const cache = new QueryClient()
  const chaves = [
    ['estrutura-empresa', 'gestora'],
    ['carteira', 'gestora', 'quadro', {}],
  ]
  for (const chave of chaves) cache.setQueryData(chave, [])
  await invalidarNumeros(cache)
  expect(
    chaves.map((chave) => cache.getQueryState(chave)?.isInvalidated),
  ).toEqual([true, true])
})
