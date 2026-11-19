import { type QueryClient, queryOptions } from '@tanstack/react-query'
import {
  lerAgendaFn,
  lerPainelFn,
  lerQuadroFn,
  listarContatosFn,
} from './carteira-leitura-fns'
import type {
  AlvoPainel,
  FiltrosContatos,
  FiltrosQuadro,
} from './carteira-leitura-tipos'

export function contatosQuery(
  usuarioId: string,
  filtros: FiltrosContatos = {},
) {
  return queryOptions({
    queryKey: ['carteira', usuarioId, 'contatos', filtros],
    queryFn: () => listarContatosFn({ data: filtros }),
    staleTime: 30_000,
  })
}
export function quadroQuery(usuarioId: string, filtros: FiltrosQuadro = {}) {
  return queryOptions({
    queryKey: ['carteira', usuarioId, 'quadro', filtros],
    queryFn: () => lerQuadroFn({ data: filtros }),
    staleTime: 30_000,
  })
}
export function painelQuery(usuarioId: string, alvo: AlvoPainel) {
  return queryOptions({
    queryKey: ['carteira', usuarioId, 'painel', alvo],
    queryFn: () => lerPainelFn({ data: alvo }),
    staleTime: 30_000,
  })
}
export function invalidarCarteira(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ['carteira'] }),
    client.invalidateQueries({ queryKey: ['wa-conversas'] }),
  ])
}

export function agendaQuery(usuarioId: string) {
  return queryOptions({
    queryKey: ['carteira', usuarioId, 'agenda'],
    queryFn: () => lerAgendaFn(),
    staleTime: 30_000,
  })
}
