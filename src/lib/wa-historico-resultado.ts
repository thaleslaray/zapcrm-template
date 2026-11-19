import type { pedidosHistorico } from '#/db/schema'
import { objeto } from './uazapi'

type Registro = typeof pedidosHistorico.$inferSelect
export type EstadoHistorico = Registro['estado']
type Proximo = NonNullable<Registro['proximo']>
export type ResultadoManual = {
  tipo: 'resultado-manual'
  pedido: string
  chat: string | null
  estado: EstadoHistorico
  motivo: string | null
  proximo: Proximo | null
}

function lerProximo(valor: unknown): Proximo | null {
  const p = objeto(valor)
  if (
    typeof p.number !== 'string' ||
    !p.number ||
    p.number.length > 255 ||
    typeof p.count !== 'number' ||
    !Number.isInteger(p.count) ||
    p.count < 1 ||
    p.count > 100 ||
    typeof p.messageid !== 'string' ||
    !p.messageid ||
    p.messageid.length > 255 ||
    typeof p.timestamp !== 'number' ||
    !Number.isSafeInteger(p.timestamp) ||
    p.timestamp <= 0 ||
    typeof p.fromMe !== 'boolean'
  )
    return null
  return {
    number: p.number,
    count: p.count,
    messageid: p.messageid,
    timestamp: p.timestamp,
    fromMe: p.fromMe,
  }
}

const motivos = [
  'pagination_no_progress',
  'anchor_unavailable',
  'history_access_unavailable',
  'cursor_lookup_failed',
]

export function lerResultadoManual(
  a: Record<string, unknown>,
): ResultadoManual | null {
  if (
    a.event !== 'status' ||
    typeof a.request_id !== 'string' ||
    !a.request_id ||
    a.request_id.length > 255 ||
    (a.request_chat != null &&
      (typeof a.request_chat !== 'string' ||
        !a.request_chat ||
        a.request_chat.length > 255))
  )
    return null
  const proximo = lerProximo(a.next_request)
  let estado: EstadoHistorico
  if (a.status === 'blocked') estado = 'bloqueado'
  else if (a.history_access === 'unavailable') estado = 'inacessivel'
  else if (a.status === 'timeout') estado = 'expirado'
  else if (a.status !== 'completed') return null
  else if (a.has_more === false) estado = 'inicio'
  else estado = proximo ? 'mais' : 'inconclusivo'
  return {
    tipo: 'resultado-manual',
    chat: a.request_chat ?? null,
    pedido: a.request_id,
    estado,
    motivo:
      typeof a.error === 'string' && motivos.includes(a.error) ? a.error : null,
    proximo: estado === 'mais' || estado === 'expirado' ? proximo : null,
  }
}

export async function aplicarResultadoManual(
  db: Pick<D1Database, 'prepare'>,
  numero: string,
  vinculo: string | null,
  r: ResultadoManual,
) {
  // Respostas de outro número, de outro chat e de pedidos anteriores não movem o cursor.
  // A lista de permissão evita guardar no D1 campos arbitrários do envelope autenticado.
  const pertence =
    "(? IN (c.jid,c.lid) OR ?=replace(c.jid,'@s.whatsapp.net',''))"
  const numeroSeguinte = r.proximo?.number ?? ''
  await db
    .prepare(`UPDATE pedidos_historico AS p SET
    estado=CASE WHEN ?='mais' AND NOT coalesce(${pertence},0) THEN 'inconclusivo' ELSE ? END,
    motivo=?, proximo=CASE WHEN ${pertence} THEN ? WHEN ?='expirado' THEN proximo ELSE NULL END
    FROM conversas c JOIN numeros n ON n.id=c.numero_id
    WHERE p.conversa_id=c.id AND n.id=? AND n.token_cifrado IS ? AND p.pedido_id=?
      AND p.estado IN ('pendente','incerto') AND (? IS NULL OR ${pertence})`)
    .bind(
      r.estado,
      numeroSeguinte,
      numeroSeguinte,
      r.estado,
      r.motivo,
      numeroSeguinte,
      numeroSeguinte,
      r.proximo ? JSON.stringify(r.proximo) : null,
      r.estado,
      numero,
      vinculo,
      r.pedido,
      r.chat,
      r.chat,
      r.chat,
    )
    .run()
}

// A uazapi encerra o pedido em dois minutos. A folga cobre o transporte do aviso.
export const ESPERA_HISTORICO_MS = 150_000

export function resumoHistorico(
  estado: EstadoHistorico | null,
  motivo: string | null,
  inicio: number | null,
) {
  if ((estado === 'pendente' || estado === 'incerto') && inicio !== null) {
    const venceEm = inicio + ESPERA_HISTORICO_MS
    if (venceEm > Date.now()) return { estado, motivo, venceEm }
    return { estado: 'expirado' as const, motivo, venceEm: null }
  }
  return { estado: estado ?? ('disponivel' as const), motivo, venceEm: null }
}
