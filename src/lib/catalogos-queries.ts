import { type QueryClient, queryOptions } from '@tanstack/react-query'
import { invalidarCarteira } from './carteira-queries'
import { listarEtiquetasGestaoFn, listarRespostasFn } from './catalogos-fns'

export function etiquetasGestaoQuery(usuario: string) {
  return queryOptions({
    queryKey: ['etiquetas-gestao', usuario],
    queryFn: () => listarEtiquetasGestaoFn(),
    staleTime: 30_000,
  })
}

export function respostasQuery(usuario: string) {
  return queryOptions({
    queryKey: ['respostas-rapidas', usuario],
    queryFn: () => listarRespostasFn(),
    staleTime: 30_000,
  })
}

export async function invalidarCatalogo(
  cache: QueryClient,
  tipo: 'etiquetas' | 'respostas',
) {
  if (tipo === 'respostas') {
    await cache.invalidateQueries({ queryKey: ['respostas-rapidas'] })
  } else {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ['etiquetas-gestao'] }),
      invalidarCarteira(cache),
    ])
  }
}
