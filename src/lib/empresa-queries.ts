import { type QueryClient, queryOptions } from '@tanstack/react-query'
import { invalidarCarteira } from './carteira-queries'
import { listarEquipeFn, listarEstruturaFn } from './empresa-fns'

export function estruturaQuery(usuario: string) {
  return queryOptions({
    queryKey: ['estrutura-empresa', usuario],
    queryFn: () => listarEstruturaFn(),
    staleTime: 30_000,
  })
}

export function equipeQuery(usuario: string) {
  return queryOptions({
    queryKey: ['equipe-empresa', usuario],
    queryFn: () => listarEquipeFn(),
    staleTime: 30_000,
  })
}

export async function invalidarEmpresa(cache: QueryClient) {
  await Promise.all([
    invalidarCarteira(cache),
    ...[
      'estrutura-empresa',
      'equipe-empresa',
      'acesso-crm',
      'wa-numeros',
      'wa-chat',
    ].map((chave) => cache.invalidateQueries({ queryKey: [chave] })),
  ])
}
