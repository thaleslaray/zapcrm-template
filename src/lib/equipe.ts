import { and, eq, exists, isNull, notExists } from 'drizzle-orm'
import type { getDb } from '#/db'
import { user } from '#/db/auth-schema'
import {
  acessosRevogados,
  convites,
  convitesSetores,
  pessoas,
  pessoasSetores,
  setores,
} from '#/db/schema'
import { setoresVisiveis } from './acesso-crm'
import { normalizeEmail } from './allowlist'
import { hasEmailProvider, sendEmail } from './email'
import { conviteEquipeEmail } from './email-templates'
import { conferirUltimoGestor, garantirSubstituto } from './ultimo-gestor'

type Banco = ReturnType<typeof getDb>
type Papel = 'gestor' | 'vendedor'
export type ComandoEquipe =
  | {
      tipo: 'convidar'
      id: string
      email: string
      papel: Papel
      setores: string[]
    }
  | { tipo: 'editarPessoa'; id: string; papel: Papel; setores: string[] }
  | { tipo: 'removerPessoa' | 'cancelarConvite'; id: string }

type AvisoEquipe = { mensagem: string; endereco?: string }

async function acessoGestor(db: Banco, usuarioId: string) {
  const acesso = await setoresVisiveis(db, usuarioId)
  if (acesso.papel !== 'gestor') throw new Error('Sem acesso')
  return acesso
}

function comSetores<T extends { id: string }>(
  lista: T[],
  vinculos: { id: string; setor: string }[],
) {
  const porId = new Map<string, string[]>()
  for (const { id, setor } of vinculos) {
    const ids = porId.get(id) ?? []
    ids.push(setor)
    porId.set(id, ids)
  }
  return lista.map((item) => ({ ...item, setores: porId.get(item.id) ?? [] }))
}

export async function listarEquipe(db: Banco, usuarioId: string) {
  const gestor = db
    .select({ id: pessoas.usuarioId })
    .from(pessoas)
    .innerJoin(user, eq(user.id, pessoas.usuarioId))
    .where(
      and(
        eq(pessoas.usuarioId, usuarioId),
        eq(pessoas.papel, 'gestor'),
        isNull(user.deletedAt),
      ),
    )
  const permitido = exists(gestor)
  const [, [autor, membros, vinculos, pendentes, concedidos, listaSetores]] =
    await Promise.all([
      acessoGestor(db, usuarioId),
      db.batch([
        gestor,
        db
          .select({
            id: user.id,
            nome: user.name,
            email: user.email,
            papel: pessoas.papel,
          })
          .from(pessoas)
          .innerJoin(user, eq(user.id, pessoas.usuarioId))
          .where(and(permitido, isNull(user.deletedAt)))
          .orderBy(user.name, user.id),
        db
          .select({
            id: pessoasSetores.usuarioId,
            setor: pessoasSetores.setorId,
          })
          .from(pessoasSetores)
          .where(permitido)
          .orderBy(pessoasSetores.setorId),
        db
          .select({
            id: convites.id,
            email: convites.email,
            papel: convites.papel,
          })
          .from(convites)
          .where(
            and(
              permitido,
              isNull(convites.aceitoEm),
              notExists(
                db
                  .select({ email: acessosRevogados.email })
                  .from(acessosRevogados)
                  .where(eq(acessosRevogados.email, convites.email)),
              ),
            ),
          )
          .orderBy(convites.email),
        db
          .select({
            id: convitesSetores.conviteId,
            setor: convitesSetores.setorId,
          })
          .from(convitesSetores)
          .where(permitido)
          .orderBy(convitesSetores.setorId),
        db
          .select({ id: setores.id, nome: setores.nome })
          .from(setores)
          .where(permitido)
          .orderBy(setores.nome),
      ]),
    ])
  if (!autor.length) throw new Error('Sem acesso')
  return {
    pessoas: comSetores(membros, vinculos),
    convites: comSetores(pendentes, concedidos),
    setores: listaSetores,
  }
}

// A decisão de visibilidade vem de setoresVisiveis. A condição repetida no lote
// impede uma escrita que já estava em voo quando outro gestor retirou o papel.
const gestorAtivo = `EXISTS (SELECT 1 FROM pessoas p JOIN user u ON u.id=p.usuario_id
  WHERE p.usuario_id=?1 AND p.papel='gestor' AND u.deleted_at IS NULL)`

async function convidar(
  db: Banco,
  autor: string,
  c: Extract<ComandoEquipe, { tipo: 'convidar' }>,
  endereco: string,
): Promise<AvisoEquipe> {
  if (
    typeof c.email !== 'string' ||
    c.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())
  )
    throw new Error('Informe um e-mail válido.')
  const email = normalizeEmail(c.email)
  const id = c.id
  const banco = db.$client
  const [permissao, criado, , , estado, encerrado] = await banco.batch([
    banco.prepare(`SELECT 1 WHERE ${gestorAtivo}`).bind(autor),
    banco
      .prepare(`INSERT INTO convites (id,email,papel)
      SELECT ?2,?3,?4 WHERE ${gestorAtivo}
      AND NOT EXISTS (SELECT 1 FROM convites_encerrados WHERE id=?2)
      AND NOT EXISTS (SELECT 1 FROM pessoas p JOIN user u ON u.id=p.usuario_id WHERE u.email=?3)
      ON CONFLICT DO NOTHING`)
      .bind(autor, id, email, c.papel),
    banco
      .prepare(`INSERT INTO convites_setores (convite_id,setor_id)
      SELECT ?1,value FROM json_each(?2) WHERE changes()>0`)
      .bind(id, JSON.stringify(c.setores)),
    banco
      .prepare(`DELETE FROM acessos_revogados WHERE email=?3 AND ${gestorAtivo}
      AND EXISTS (SELECT 1 FROM convites WHERE id=?2 AND email=?3 AND aceito_em IS NULL)`)
      .bind(autor, id, email),
    banco
      .prepare(`SELECT email,papel,aceito_em, (SELECT json_group_array(setor_id)
      FROM (SELECT setor_id FROM convites_setores WHERE convite_id=?1 ORDER BY setor_id)) AS setores
      FROM convites WHERE id=?1`)
      .bind(id),
    banco.prepare('SELECT 1 FROM convites_encerrados WHERE id=?').bind(id),
  ])
  if (!permissao.results.length) throw new Error('Sem acesso')
  if (encerrado.results.length)
    throw new Error('Este convite já foi cancelado ou a pessoa foi removida.')
  const linha = estado.results[0] as
    | { email: string; papel: Papel; aceito_em: number | null; setores: string }
    | undefined
  if (
    linha?.email !== email ||
    linha.papel !== c.papel ||
    (!linha.aceito_em &&
      linha.setores !== JSON.stringify([...c.setores].sort()))
  )
    throw new Error('Esta pessoa já faz parte da equipe ou já tem um convite.')
  if (!criado.meta.changes || !hasEmailProvider()) {
    return {
      mensagem: 'Convite cadastrado. Copie o endereço de entrada.',
      endereco,
    }
  }
  try {
    await sendEmail({ to: email, ...conviteEquipeEmail(endereco) })
    return { mensagem: 'Convite enviado por e-mail.' }
  } catch {
    return {
      mensagem:
        'Convite cadastrado. O envio do e-mail falhou. Copie o endereço de entrada.',
      endereco,
    }
  }
}

export async function alterarEquipe(
  db: Banco,
  autor: string,
  comando: ComandoEquipe,
  enderecoLogin: string,
): Promise<AvisoEquipe> {
  const acesso = await acessoGestor(db, autor)
  if (
    typeof comando?.id !== 'string' ||
    !comando.id.trim() ||
    comando.id.length > 100
  )
    throw new Error('Escolha uma pessoa ou convite.')
  if (comando.tipo === 'convidar' || comando.tipo === 'editarPessoa') {
    if (
      !['gestor', 'vendedor'].includes(comando.papel) ||
      !Array.isArray(comando.setores) ||
      new Set(comando.setores).size !== comando.setores.length ||
      !comando.setores.every((id) => acesso.setores.includes(id))
    )
      throw new Error('Confira o papel e os setores selecionados.')
  }
  const id = comando.id
  const banco = db.$client
  const p = (consulta: string) => banco.prepare(consulta).bind(autor, id)
  const autorizado = banco.prepare(`SELECT 1 WHERE ${gestorAtivo}`).bind(autor)
  const pessoa = 'EXISTS (SELECT 1 FROM pessoas WHERE usuario_id=?2)'
  switch (comando.tipo) {
    case 'convidar':
      return convidar(db, autor, comando, enderecoLogin)
    case 'editarPessoa': {
      const guarda =
        comando.papel === 'vendedor' ? [await garantirSubstituto(db, id)] : []
      const [permissao, ...alteracoes] = await banco
        .batch([
          autorizado,
          ...guarda,
          p(
            `DELETE FROM pessoas_setores WHERE usuario_id=?2 AND ${gestorAtivo}`,
          ),
          banco
            .prepare(`INSERT INTO pessoas_setores (usuario_id,setor_id)
          SELECT ?2, value FROM json_each(?3) WHERE ${gestorAtivo} AND ${pessoa}`)
            .bind(autor, id, JSON.stringify(comando.setores)),
          banco
            .prepare(
              `UPDATE pessoas SET papel=?3 WHERE usuario_id=?2 AND ${gestorAtivo}`,
            )
            .bind(autor, id, comando.papel),
        ])
        .catch(conferirUltimoGestor)
      if (!permissao.results.length) throw new Error('Sem acesso')
      if (!alteracoes.at(-1)?.meta.changes)
        throw new Error('A pessoa já saiu da equipe.')
      return { mensagem: 'Papel e setores salvos.' }
    }
    case 'removerPessoa': {
      const [, permissao] = await banco
        .batch([
          await garantirSubstituto(db, id),
          autorizado,
          p(
            `INSERT OR IGNORE INTO acessos_revogados (email) SELECT email FROM user WHERE id=?2 AND ${pessoa} AND ${gestorAtivo}`,
          ),
          p(
            `DELETE FROM session WHERE user_id=?2 AND ${gestorAtivo} AND ${pessoa}`,
          ),
          p(
            `DELETE FROM convites WHERE email IN (SELECT email FROM user WHERE id=?2) AND ${pessoa} AND ${gestorAtivo}`,
          ),
          p(`DELETE FROM pessoas WHERE usuario_id=?2 AND ${gestorAtivo}`),
        ])
        .catch(conferirUltimoGestor)
      if (!permissao.results.length) throw new Error('Sem acesso')
      return { mensagem: 'Pessoa removida da equipe.' }
    }
    case 'cancelarConvite': {
      const [permissao, aceito] = await banco.batch([
        autorizado,
        p(
          `SELECT 1 FROM convites WHERE id=?2 AND aceito_em IS NOT NULL AND ${gestorAtivo}`,
        ),
        p(
          `DELETE FROM convites WHERE id=?2 AND aceito_em IS NULL AND ${gestorAtivo}`,
        ),
      ])
      if (!permissao.results.length) throw new Error('Sem acesso')
      if (aceito.results.length)
        throw new Error(
          'Esta pessoa já aceitou o convite. Para retirar o acesso, remova a pessoa da equipe.',
        )
      return { mensagem: 'Convite cancelado.' }
    }
    default:
      throw new Error('Operação inválida.')
  }
}
