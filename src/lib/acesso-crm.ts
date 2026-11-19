import { and, eq, exists, inArray, or } from 'drizzle-orm'

import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { getDb } from '#/db'
import { funis, numeros, pessoas, pessoasSetores, setores } from '#/db/schema'

type Banco = ReturnType<typeof getDb>

export async function registrarEntrada(
  db: Banco,
  usuarioId: string,
  email: string,
) {
  // O lote é uma transação no D1. Mesmo duas primeiras sessões concorrentes
  // disputam o mesmo marco da instalação. Logins posteriores preservam os dados.
  const banco = db.$client
  const primeiraEntrada = 'NOT EXISTS (SELECT 1 FROM instalacao)'
  const pendente =
    'SELECT id FROM convites WHERE email=?1 AND aceito_em IS NULL'
  const autorizado =
    'NOT EXISTS (SELECT 1 FROM acessos_revogados WHERE email=?1)'
  const resultado = await banco.batch([
    banco
      .prepare(`INSERT INTO pessoas (usuario_id, papel)
      SELECT ?2, CASE WHEN ${primeiraEntrada} THEN 'gestor'
        ELSE coalesce((SELECT papel FROM convites WHERE id IN (${pendente})), 'vendedor') END
      WHERE ${autorizado}
      ON CONFLICT(usuario_id) DO NOTHING`)
      .bind(email, usuarioId),
    banco
      .prepare(`INSERT OR IGNORE INTO pessoas_setores (usuario_id, setor_id)
      SELECT ?2, setor_id FROM convites_setores
      WHERE convite_id IN (${pendente}) AND ${autorizado}`)
      .bind(email, usuarioId),
    banco
      .prepare(`UPDATE convites SET aceito_em=cast(unixepoch('subsecond') * 1000 as integer)
      WHERE id IN (${pendente}) AND ${autorizado}`)
      .bind(email),
    banco
      .prepare(`DELETE FROM convites_setores WHERE convite_id IN
      (SELECT id FROM convites WHERE email=? AND aceito_em IS NOT NULL)`)
      .bind(email),
    banco.prepare(`INSERT INTO setores (id, nome)
      SELECT * FROM (VALUES ('com','Comercial'), ('pos','Pós-venda'))
      WHERE ${primeiraEntrada}`),
    banco.prepare(`INSERT INTO funis (id, setor_id, nome, cor)
      SELECT * FROM (VALUES ('vendas','com','Vendas','#0f766e'), ('pos','pos','Pós-venda','#2563eb'))
      WHERE ${primeiraEntrada}`),
    banco.prepare(`INSERT INTO etapas (id, funil_id, nome, cor, posicao, fechamento)
      SELECT * FROM (VALUES
        ('novo','vendas','Novo','#64748b',1,NULL),
        ('qualificado','vendas','Qualificado','#2563eb',2,NULL),
        ('proposta','vendas','Proposta','#d97706',3,NULL),
        ('negociacao','vendas','Negociação','#7c3aed',4,NULL),
        ('ganho','vendas','Ganho','#16a34a',5,'sucesso'),
        ('perdido','vendas','Perdido','#b4472a',6,'perda'),
        ('agendada','pos','Instalação agendada','#0284c7',1,NULL),
        ('instalado','pos','Instalado','#0891b2',2,NULL),
        ('homologacao','pos','Homologação','#b45309',3,NULL),
        ('concluido','pos','Concluído','#16a34a',4,'sucesso'),
        ('cancelado','pos','Cancelado','#b4472a',5,'perda'))
      WHERE ${primeiraEntrada}`),
    banco.prepare('INSERT OR IGNORE INTO instalacao (id) VALUES (1)'),
    banco
      .prepare(
        `SELECT usuario_id FROM pessoas WHERE usuario_id=?2 AND ${autorizado}`,
      )
      .bind(email, usuarioId),
  ])
  return resultado[8].results.length > 0
}

// Mesma regra para a projeção de uma pessoa e para conferir, em lote,
// as sessões que ainda pertencem ao setor antes de avisar as telas abertas.
export function idsDeSetoresVisiveis(
  db: Banco,
  usuarioId: string | AnySQLiteColumn,
) {
  const membro = eq(pessoas.usuarioId, usuarioId)
  const gestor = db
    .select({ id: pessoas.usuarioId })
    .from(pessoas)
    .where(and(membro, eq(pessoas.papel, 'gestor')))
  const vinculados = db
    .select({ id: pessoasSetores.setorId })
    .from(pessoasSetores)
    .where(eq(pessoasSetores.usuarioId, usuarioId))
  return db
    .select({ id: setores.id })
    .from(setores)
    .where(or(exists(gestor), inArray(setores.id, vinculados)))
}

export async function setoresVisiveis(db: Banco, usuarioId: string) {
  const membro = eq(pessoas.usuarioId, usuarioId)
  const permitidos = idsDeSetoresVisiveis(db, usuarioId)
  const [[pessoa], listaSetores, listaNumeros, listaFunis] = await db.batch([
    db.select({ papel: pessoas.papel }).from(pessoas).where(membro),
    permitidos.orderBy(setores.id),
    db
      .select({ id: numeros.id })
      .from(numeros)
      .where(inArray(numeros.setorId, permitidos))
      .orderBy(numeros.id),
    db
      .select({ id: funis.id })
      .from(funis)
      .where(inArray(funis.setorId, permitidos))
      .orderBy(funis.id),
  ])
  if (!pessoa) throw new Error('Entre novamente para acessar a equipe.')
  return {
    papel: pessoa.papel,
    setores: listaSetores.map((s) => s.id),
    numeros: listaNumeros.map((n) => n.id),
    funis: listaFunis.map((f) => f.id),
  }
}
