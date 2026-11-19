import { type QueryClient, queryOptions } from '@tanstack/react-query'
import { leituraDaEquipe } from './tempo-real-protocolo'
import { catalogoNumerosFn, painelNumerosFn } from './wa-numeros-fns'

export const painelNumerosQuery = (usuario: string) =>
  queryOptions({
    queryKey: ['wa-numeros', usuario],
    queryFn: () => painelNumerosFn({ headers: leituraDaEquipe }),
    staleTime: 2500,
  })
export const catalogoNumerosQuery = (usuario: string) =>
  queryOptions({
    queryKey: ['wa-catalogo', usuario],
    queryFn: () => catalogoNumerosFn(),
    staleTime: 0,
    retry: false,
  })

export function invalidarNumeros(q: QueryClient) {
  return Promise.all(
    [
      'wa-numeros',
      'wa-catalogo',
      'acesso-crm',
      'wa-conversas',
      'estrutura-empresa',
      'carteira',
    ].map((chave) => q.invalidateQueries({ queryKey: [chave] })),
  )
}
