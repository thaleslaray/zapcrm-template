import { queryOptions } from '@tanstack/react-query'

import { acessoCrmFn } from '#/lib/acesso-crm-fns'

export function acessoCrmQuery(usuarioId: string) {
  return queryOptions({
    queryKey: ['acesso-crm', usuarioId],
    queryFn: () => acessoCrmFn(),
    staleTime: 0,
  })
}
