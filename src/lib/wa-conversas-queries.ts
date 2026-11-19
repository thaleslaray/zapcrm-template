import { type QueryClient, queryOptions } from '@tanstack/react-query'
import { leituraDaEquipe } from '#/lib/tempo-real-protocolo'
import { filaConversasFn, lerChatFn } from '#/lib/wa-conversas-fns'

export function conversasQuery(usuario: string) {
  return queryOptions({
    queryKey: ['wa-conversas', usuario],
    queryFn: () => filaConversasFn({ headers: leituraDaEquipe }),
    staleTime: 3000,
    refetchInterval: ({ state }) => {
      const prazo = state.data?.ateProximoRetorno
      if (prazo == null) return false
      return Math.min(
        2_147_483_647,
        Math.max(100, state.dataUpdatedAt + prazo + 1 - Date.now()),
      )
    },
  })
}
export function mensagensQuery(usuario: string, id: string) {
  return queryOptions({
    queryKey: ['wa-chat', usuario, id],
    queryFn: () => lerChatFn({ data: id, headers: leituraDaEquipe }),
    refetchInterval: ({ state }) => {
      const prazo = state.data?.historico.venceEm
      return prazo == null ? false : Math.max(250, prazo - Date.now() + 1)
    },
    staleTime: 3000,
  })
}
export async function invalidarConversa(
  cache: QueryClient,
  usuario: string,
  id: string,
) {
  await Promise.all([
    cache.invalidateQueries({ queryKey: ['wa-conversas', usuario] }),
    cache.invalidateQueries({ queryKey: ['wa-chat', usuario, id] }),
  ])
}
