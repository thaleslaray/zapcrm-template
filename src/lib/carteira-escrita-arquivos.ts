import { and, eq, inArray, lte } from 'drizzle-orm'
import type { getDb } from '#/db'
import { arquivosEmExclusao } from '#/db/schema'

// Cada chave usa um parâmetro do DELETE no D1. O cron faz um lote por noite;
// o pedido que confirmou a exclusão esvazia todos os lotes daquele contato.
const TAMANHO_LOTE = 64
export async function limparArquivosExcluidos(
  db: ReturnType<typeof getDb>,
  bucket: Pick<R2Bucket, 'delete'>,
  contatoId?: string,
) {
  let quantidade = 0
  let loteCompleto: boolean
  do {
    const lote = await db
      .select({ chave: arquivosEmExclusao.chave })
      .from(arquivosEmExclusao)
      .where(
        and(
          lte(arquivosEmExclusao.limparApos, Date.now()),
          contatoId === undefined
            ? undefined
            : eq(arquivosEmExclusao.contatoId, contatoId),
        ),
      )
      .limit(TAMANHO_LOTE)
    if (!lote.length) break
    const chaves = lote.map((item) => item.chave)
    try {
      await bucket.delete(chaves)
      await db
        .delete(arquivosEmExclusao)
        .where(inArray(arquivosEmExclusao.chave, chaves))
    } catch {
      throw new Error('A limpeza dos arquivos será retomada.')
    }
    quantidade += lote.length
    loteCompleto = lote.length === TAMANHO_LOTE
  } while (contatoId !== undefined && loteCompleto)
  return quantidade
}
