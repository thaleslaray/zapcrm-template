import { and, eq, isNull, sql } from 'drizzle-orm'
import type { getDb } from '#/db'
import { notas } from '#/db/schema'

export type ComandoNota =
  | {
      tipo: 'criarNota' | 'editarNota'
      id: string
      contatoId: string
      texto: string
    }
  | {
      tipo: 'criarNotaInterna'
      id: string
      contatoId: string
      conversaId: string
      texto: string
    }
  | { tipo: 'apagarNota'; id: string; contatoId: string }

export async function gravarNota(
  db: ReturnType<typeof getDb>,
  numerosVisiveis: string[],
  usuarioId: string,
  c: ComandoNota,
) {
  const conversaId = c.tipo === 'criarNotaInterna' ? c.conversaId : null
  const conversaVisivel = conversaId
    ? sql`EXISTS (SELECT 1 FROM conversas WHERE id=${conversaId} AND contato_id=${c.contatoId} AND numero_id IN (SELECT value FROM json_each(${JSON.stringify(numerosVisiveis)})))`
    : sql`1`
  const alvo = and(
    eq(notas.id, c.id),
    eq(notas.contatoId, c.contatoId),
    conversaId ? eq(notas.conversaId, conversaId) : isNull(notas.conversaId),
    conversaVisivel,
  )
  const confirmado = { ok: true as const, contatoId: c.contatoId }
  const falha = {
    ok: false as const,
    mensagem: 'Não foi possível confirmar a nota.',
  }
  if (c.tipo === 'apagarNota') {
    const [, [restou]] = await db.batch([
      db.delete(notas).where(alvo),
      db.select({ id: notas.id }).from(notas).where(eq(notas.id, c.id)),
    ])
    return restou ? falha : confirmado
  }
  if (typeof c.texto !== 'string' || !c.texto.trim() || c.texto.length > 4000)
    return {
      ok: false as const,
      mensagem: 'Escreva uma nota com até 4.000 caracteres.',
    }
  const texto = c.texto.trim()
  if (c.tipo === 'editarNota') {
    const [salva] = await db
      .update(notas)
      .set({ texto })
      .where(alvo)
      .returning({ id: notas.id })
    return salva ? confirmado : falha
  }
  const [, [salva]] = await db.batch([
    db
      .insert(notas)
      .select(sql`SELECT ${c.id}, id, ${conversaId}, ${usuarioId}, ${texto}, ${Date.now()}
      FROM contatos WHERE id=${c.contatoId} AND ${conversaVisivel}`)
      .onConflictDoNothing({ target: notas.id }),
    db
      .select({ id: notas.id })
      .from(notas)
      .where(and(alvo, eq(notas.autorId, usuarioId), eq(notas.texto, texto))),
  ])
  return salva ? confirmado : falha
}
