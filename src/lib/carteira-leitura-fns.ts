import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { getDb } from '#/db'
import { lerPainel, lerQuadro, listarContatos } from './carteira-leitura'
import type {
  AlvoPainel,
  FiltrosContatos,
  FiltrosQuadro,
} from './carteira-leitura-tipos'
import { exigirLogin } from './exigir-login'
import { limitarUsuario } from './rate-limit'
import { getRequestSession } from './request-session'
import { lerAgenda } from './retornos-leitura'

async function contextoLeitura() {
  const sessao = await getRequestSession()
  if (!sessao) exigirLogin()
  await limitarUsuario(sessao.user.id, 'leitura')
  return { db: getDb(env.DB), usuarioId: sessao.user.id }
}

function texto(entrada: unknown, chave: string) {
  if (typeof entrada !== 'object' || entrada === null || Array.isArray(entrada))
    throw new Error('Filtro inválido.')
  const valor = (entrada as Record<string, unknown>)[chave]
  if (valor === undefined || valor === '') return undefined
  if (typeof valor !== 'string' || valor.length > 180)
    throw new Error('Filtro inválido.')
  return valor
}

// O termo de busca pode ser o telefone ou nome de um cliente. Ele viaja no corpo.
export const listarContatosFn = createServerFn({ method: 'POST' })
  .validator((entrada: FiltrosContatos) => {
    const ordem = texto(entrada, 'ordem'),
      direcao = texto(entrada, 'direcao')
    if (ordem !== undefined && ordem !== 'valor' && ordem !== 'ultima')
      throw new Error('Ordenação inválida.')
    if (direcao !== undefined && direcao !== 'asc' && direcao !== 'desc')
      throw new Error('Ordenação inválida.')
    return {
      busca: texto(entrada, 'busca'),
      etapaId: texto(entrada, 'etapaId'),
      etiquetaId: texto(entrada, 'etiquetaId'),
      responsavelId: texto(entrada, 'responsavelId'),
      ordem,
      direcao,
    } satisfies FiltrosContatos
  })
  .handler(async ({ data }) => {
    const { db, usuarioId } = await contextoLeitura()
    return listarContatos(db, usuarioId, data)
  })

export const lerQuadroFn = createServerFn({ method: 'GET' })
  .validator((entrada: FiltrosQuadro) => ({
    funilId: texto(entrada, 'funilId'),
    numeroId: texto(entrada, 'numeroId'),
    responsavelId: texto(entrada, 'responsavelId'),
  }))
  .handler(async ({ data }) => {
    const { db, usuarioId } = await contextoLeitura()
    return lerQuadro(db, usuarioId, data)
  })

export const lerPainelFn = createServerFn({ method: 'GET' })
  .validator((entrada: AlvoPainel) => ({
    contatoId: texto(entrada, 'contatoId'),
    conversaId: texto(entrada, 'conversaId'),
    funilId: texto(entrada, 'funilId'),
  }))
  .handler(async ({ data }) => {
    const { db, usuarioId } = await contextoLeitura()
    return lerPainel(db, usuarioId, data)
  })

export const lerAgendaFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { db, usuarioId } = await contextoLeitura()
    return lerAgenda(db, usuarioId)
  },
)
