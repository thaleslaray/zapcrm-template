import { type SQL, sql } from 'drizzle-orm'
import type { getDb } from '#/db'
import type { setoresVisiveis } from './acesso-crm'
import { jidDoTelefone } from './telefone'

type Alvo = {
  tipo: 'retorno'
  id: string
  contatoId: string
  numeroId: string
}
export type ComandoRetorno = Alvo &
  (
    | { acao: 'marcar' | 'alterar'; marcadoPara: number; motivo: string }
    | { acao: 'adiar'; marcadoPara: number }
    | { acao: 'feito' | 'desfazer' }
  )

export async function gravarRetorno(
  db: ReturnType<typeof getDb>,
  acesso: Awaited<ReturnType<typeof setoresVisiveis>>,
  usuarioId: string,
  c: ComandoRetorno,
) {
  const recusar = (mensagem: string) => ({ ok: false as const, mensagem })
  const salvo = { ok: true as const, contatoId: c.contatoId }
  if (
    !acesso.numeros.includes(c.numeroId) ||
    typeof c.id !== 'string' ||
    !c.id.length ||
    c.id.length > 128 ||
    typeof c.contatoId !== 'string' ||
    !c.contatoId.length ||
    c.contatoId.length > 128
  )
    return recusar('Sem acesso.')
  if (
    (c.acao === 'marcar' || c.acao === 'alterar' || c.acao === 'adiar') &&
    (!Number.isSafeInteger(c.marcadoPara) ||
      c.marcadoPara < 0 ||
      c.marcadoPara > 253402300799999)
  )
    return recusar('Informe data e hora válidas.')
  if (
    (c.acao === 'marcar' || c.acao === 'alterar') &&
    (typeof c.motivo !== 'string' || !c.motivo.trim() || c.motivo.length > 500)
  )
    return recusar('Informe um motivo de até 500 caracteres.')

  const par = sql`contato_id = ${c.contatoId} AND numero_id = ${c.numeroId}`
  const alvo = sql`id = ${c.id} AND ${par}`
  if (c.acao === 'marcar') {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(c.id))
      return recusar('Atualize o formulário para marcar o retorno.')
    // O INSERT condicional impede duas abas de criarem dois próximos retornos.
    // O id do formulário confirma uma repetição mesmo após perder a resposta.
    const banco = db.$client
    const contato = await banco
      .prepare('SELECT telefone FROM contatos WHERE id=?')
      .bind(c.contatoId)
      .first<{ telefone: string | null }>()
    const telefone = contato?.telefone ?? null
    const [gravacao] = await banco.batch([
      banco
        .prepare(`INSERT INTO retornos (id,contato_id,numero_id,responsavel_id,marcado_para,motivo)
        SELECT ?1,?2,?3,coalesce((
          SELECT n.responsavel_id FROM negocios n JOIN funis f ON f.id=n.funil_id
          JOIN numeros canal ON canal.id=?3 AND canal.setor_id=f.setor_id
          WHERE n.contato_id=?2 AND n.fechado_em IS NULL
          ORDER BY n.numero_id=canal.id DESC,n.criado_em DESC,n.id LIMIT 1
        ),?4),?5,?6 FROM contatos c WHERE c.id=?2
        AND (c.telefone=?7 OR EXISTS(SELECT 1 FROM conversas WHERE contato_id=?2 AND numero_id=?3))
        AND NOT EXISTS(SELECT 1 FROM retornos WHERE contato_id=?2 AND numero_id=?3 AND feito_em IS NULL AND id<>?1)
        ON CONFLICT(id) DO UPDATE SET id=excluded.id
        WHERE id=?1 AND contato_id=?2 AND numero_id=?3 AND motivo=excluded.motivo AND marcado_para=excluded.marcado_para AND feito_em IS NULL
        RETURNING id`)
        .bind(
          c.id,
          c.contatoId,
          c.numeroId,
          usuarioId,
          c.marcadoPara,
          c.motivo.trim(),
          telefone,
        ),
      banco
        .prepare(`INSERT INTO conversas (id,contato_id,numero_id,jid)
        SELECT ?1,?2,?3,?4 WHERE changes()=1 AND ?4 IS NOT NULL
        ON CONFLICT(numero_id,contato_id) DO NOTHING`)
        .bind(
          crypto.randomUUID(),
          c.contatoId,
          c.numeroId,
          telefone ? jidDoTelefone(telefone) : null,
        ),
    ])
    return gravacao.results.length
      ? salvo
      : recusar('O próximo retorno mudou. Reabra o painel para conferir.')
  }
  let alteracao: SQL
  let condicao = sql`feito_em IS NULL`
  switch (c.acao) {
    case 'alterar':
      alteracao = sql`marcado_para=${c.marcadoPara},motivo=${c.motivo.trim()}`
      break
    case 'adiar':
      alteracao = sql`marcado_para=${c.marcadoPara}`
      break
    case 'feito':
      alteracao = sql`feito_em=coalesce(feito_em,${Date.now()})`
      condicao = sql`1`
      break
    case 'desfazer':
      alteracao = sql`feito_em=NULL`
      condicao = sql`NOT EXISTS (SELECT 1 FROM retornos WHERE ${par} AND id<>${c.id} AND feito_em IS NULL)`
      break
    default:
      return recusar('Operação de retorno inválida.')
  }
  const resultado = await db.run(
    sql`UPDATE retornos SET ${alteracao} WHERE ${alvo} AND ${condicao}`,
  )
  return resultado.meta.changes === 1
    ? salvo
    : recusar('Retorno indisponível ou sem acesso.')
}
