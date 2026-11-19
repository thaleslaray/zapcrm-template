import { createHash } from 'node:crypto'
import type { getDb } from '#/db'

// O identificador do provedor pode conter um telefone. O expurgo conserva só
// o resumo com o escopo do número, pelo prazo máximo de importação da uazapi.
export const marcaReentrega = (numero: string, identificador: string) =>
  createHash('sha256')
    .update(JSON.stringify([numero, identificador]))
    .digest('hex')

// Um telefone pertence à carteira inteira; um LID só identifica o chat naquele número.
export const marcaChatExcluido = (numero: string | null, identidade: string) =>
  createHash('sha256')
    .update(JSON.stringify(['chat', numero, identidade]))
    .digest('hex')

export async function identidadesParaExclusao(
  db: ReturnType<typeof getDb>,
  contatoId: string,
) {
  const { results } = await db.$client
    .prepare(`SELECT ct.telefone_normalizado AS chave,
    cv.numero_id AS numero,cv.lid FROM contatos ct LEFT JOIN conversas cv ON cv.contato_id=ct.id
    WHERE ct.id=?`)
    .bind(contatoId)
    .all<{ chave: string | null; numero: string | null; lid: string | null }>()
  return results.map((r) => ({
    ...r,
    marcaTelefone: r.chave && marcaChatExcluido(null, r.chave),
    marcaLid: r.numero && r.lid && marcaChatExcluido(r.numero, r.lid),
  }))
}

export async function completarMarcasAntesDeApagar(
  db: ReturnType<typeof getDb>,
  contatoId: string,
) {
  const banco = db.$client
  for (;;) {
    const { results } = await banco
      .prepare(`SELECT m.id,m.numero_id,m.identificador FROM mensagens m
      JOIN conversas c ON c.id=m.conversa_id WHERE c.contato_id=? AND m.identificador IS NOT NULL
      AND m.marca_reentrega IS NULL LIMIT 64`)
      .bind(contatoId)
      .all<{ id: string; numero_id: string; identificador: string }>()
    if (!results.length) return
    const marcas = results.map((m) => ({
      ...m,
      marca: marcaReentrega(m.numero_id, m.identificador),
    }))
    await banco
      .prepare(`UPDATE mensagens SET marca_reentrega=j.value->>'marca' FROM json_each(?) j
      WHERE mensagens.id=j.value->>'id' AND mensagens.identificador=j.value->>'identificador'
      AND mensagens.marca_reentrega IS NULL`)
      .bind(JSON.stringify(marcas))
      .run()
  }
}
