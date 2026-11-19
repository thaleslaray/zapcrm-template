import { type SQL, sql } from 'drizzle-orm'
import type { getDb } from '#/db'
import { setoresVisiveis } from './acesso-crm'
import { nomeDoContato } from './telefone'

/** A fonte da agenda, dos selos e do próximo retorno. Os números vêm de setoresVisiveis. */
export function retornosVisiveis(
  numeros: SQL,
  condicao: SQL = sql`1`,
  incluirFeitos = false,
) {
  return sql`SELECT r.id, r.contato_id AS contatoId, r.numero_id AS numeroId,
    r.responsavel_id AS responsavelId, r.marcado_para AS marcadoPara, r.motivo, r.feito_em AS feitoEm
    FROM retornos r WHERE r.numero_id IN ${numeros} AND ${condicao}
      AND ${incluirFeitos ? sql`1` : sql`r.feito_em IS NULL`}`
}

export async function lerAgenda(db: ReturnType<typeof getDb>, usuario: string) {
  const acesso = await setoresVisiveis(db, usuario)
  if (acesso.papel !== 'gestor' && !acesso.setores.length)
    throw new Error('Aguardando o gestor liberar um setor para você')
  const numeros = sql`(SELECT value FROM json_each(${JSON.stringify(acesso.numeros)}))`
  const gestor = acesso.papel === 'gestor'
  const [itens, pessoas] = await Promise.all([
    db.all<
      ItemAgenda & {
        telefone: string | null
        telefoneNormalizado: string | null
      }
    >(sql`SELECT a.*, c.nome, c.telefone, c.telefone_normalizado AS telefoneNormalizado, c.empresa, u.name AS responsavelNome,
      cv.id AS conversaId, num.nome AS numeroNome, num.cor AS numeroCor, e.nome AS etapaNome, e.cor AS etapaCor
      FROM (${retornosVisiveis(numeros, sql`1`, true)}) a
      JOIN contatos c ON c.id=a.contatoId JOIN numeros num ON num.id=a.numeroId
      LEFT JOIN user u ON u.id=a.responsavelId
      LEFT JOIN conversas cv ON cv.numero_id=a.numeroId AND cv.contato_id=a.contatoId
      LEFT JOIN etapas e ON e.id=(SELECT n.etapa_id FROM negocios n JOIN funis f ON f.id=n.funil_id
        WHERE n.contato_id=a.contatoId AND f.setor_id=num.setor_id
        ORDER BY n.fechado_em IS NULL DESC,n.criado_em DESC,n.id LIMIT 1)
      ORDER BY a.marcadoPara,c.nome,a.id`),
    gestor
      ? db.all<{ id: string; nome: string }>(
          sql`SELECT u.id,u.name AS nome FROM pessoas p JOIN user u ON u.id=p.usuario_id ORDER BY u.name,u.id`,
        )
      : [],
  ])
  return {
    gestor,
    itens: itens.map(({ telefone, telefoneNormalizado, ...item }) => ({
      ...item,
      nome: nomeDoContato({ nome: item.nome, telefone, telefoneNormalizado }),
    })),
    pessoas,
  }
}

export interface ItemAgenda {
  id: string
  contatoId: string
  numeroId: string
  responsavelId: string | null
  marcadoPara: number
  motivo: string
  feitoEm: number | null
  nome: string
  empresa: string | null
  responsavelNome: string | null
  conversaId: string | null
  numeroNome: string
  numeroCor: string
  etapaNome: string | null
  etapaCor: string | null
}
