import { and, asc, count, eq, isNull, type SQL, sql } from 'drizzle-orm'
import type { getDb } from '#/db'
import { user } from '#/db/auth-schema'
import {
  etapas,
  funis,
  negocios,
  numeros,
  pessoas,
  pessoasSetores,
  setores,
} from '#/db/schema'
import { setoresVisiveis } from './acesso-crm'

type Banco = ReturnType<typeof getDb>
type Fechamento = 'sucesso' | 'perda' | null
export type ComandoEstrutura =
  | { tipo: 'criarSetor' | 'editarSetor'; id: string; nome: string }
  | { tipo: 'apagarSetor' | 'apagarFunil' | 'apagarEtapa'; id: string }
  | {
      tipo: 'criarFunil' | 'editarFunil'
      id: string
      setorId: string
      nome: string
      cor: string
    }
  | {
      tipo: 'criarEtapa' | 'editarEtapa'
      id: string
      funilId: string
      nome: string
      cor: string
      fechamento: Fechamento
    }
  | { tipo: 'ordenarEtapas'; funilId: string; ids: string[] }
  | { tipo: 'definirFunilPadrao'; numeroId: string; funilId: string }

class ErroEstrutura extends Error {}

function gestorAtivo(usuarioId: string) {
  return sql`EXISTS (SELECT 1 FROM pessoas p JOIN user u ON u.id=p.usuario_id WHERE p.usuario_id=${usuarioId} AND p.papel='gestor' AND u.deleted_at IS NULL)`
}

async function exigirGestor(db: Banco, usuarioId: string) {
  if ((await setoresVisiveis(db, usuarioId)).papel !== 'gestor')
    throw new ErroEstrutura('Sem acesso')
  return gestorAtivo(usuarioId)
}

export async function listarEstrutura(db: Banco, usuarioId: string) {
  const gestor = gestorAtivo(usuarioId)
  // Cada seleção já exige um gestor ativo. A autorização compartilhada pode
  // sair junto com o lote sem entregar os dados antes da decisão de acesso.
  const [
    ,
    [listaSetores, listaFunis, listaEtapas, listaNumeros, listaPessoas],
  ] = await Promise.all([
    exigirGestor(db, usuarioId),
    db.batch([
      db
        .select({
          id: setores.id,
          nome: setores.nome,
          abertos: count(negocios.id),
        })
        .from(setores)
        .leftJoin(funis, eq(funis.setorId, setores.id))
        .leftJoin(
          negocios,
          and(eq(negocios.funilId, funis.id), isNull(negocios.fechadoEm)),
        )
        .where(gestor)
        .groupBy(setores.id)
        .orderBy(asc(setores.nome)),
      db
        .select()
        .from(funis)
        .where(gestor)
        .orderBy(sql`${funis.id}='vendas' DESC`, funis.nome),
      db
        .select({
          id: etapas.id,
          nome: etapas.nome,
          cor: etapas.cor,
          funilId: etapas.funilId,
          posicao: etapas.posicao,
          fechamento: etapas.fechamento,
          negocios: count(negocios.id),
        })
        .from(etapas)
        .leftJoin(negocios, eq(negocios.etapaId, etapas.id))
        .where(gestor)
        .groupBy(etapas.id)
        .orderBy(etapas.funilId, etapas.posicao, etapas.id),
      db
        .select({
          id: numeros.id,
          nome: numeros.nome,
          cor: numeros.cor,
          telefone: numeros.telefone,
          estado: numeros.estado,
          setorId: numeros.setorId,
          funilPadraoId: numeros.funilPadraoId,
        })
        .from(numeros)
        .where(gestor)
        .orderBy(numeros.nome),
      db
        .select({
          id: pessoas.usuarioId,
          nome: user.name,
          papel: pessoas.papel,
          setorId: pessoasSetores.setorId,
        })
        .from(pessoas)
        .innerJoin(user, eq(pessoas.usuarioId, user.id))
        .leftJoin(
          pessoasSetores,
          and(
            eq(pessoas.papel, 'vendedor'),
            eq(pessoasSetores.usuarioId, pessoas.usuarioId),
          ),
        )
        .where(and(gestor, isNull(user.deletedAt)))
        .orderBy(user.name),
    ]),
  ])
  return {
    setores: listaSetores,
    funis: listaFunis,
    etapas: listaEtapas,
    numeros: listaNumeros,
    pessoas: listaPessoas,
  }
}
export type Estrutura = Awaited<ReturnType<typeof listarEstrutura>>

function texto(valor: unknown) {
  if (typeof valor !== 'string' || !valor.trim() || valor.length > 100)
    throw new ErroEstrutura('Confira os campos e tente de novo.')
  return valor.trim()
}
function confirmar(resultado: D1Result, mensagem: string) {
  if (!resultado.meta.changes) throw new ErroEstrutura(mensagem)
}
const conflito =
  'O cadastro anterior já foi salvo com outros dados. Feche e use Editar.'

function corValida(valor: unknown) {
  if (typeof valor !== 'string' || !/^#[0-9a-f]{6}$/i.test(valor))
    throw new ErroEstrutura('Escolha uma cor válida.')
  return valor.toLowerCase()
}

async function criarFunil(
  db: Banco,
  gestor: SQL,
  comando: Extract<ComandoEstrutura, { setorId: string }>,
) {
  const id = texto(comando.id),
    nome = texto(comando.nome),
    setorId = texto(comando.setorId),
    cor = corValida(comando.cor)
  // changes() se refere à inserção anterior, no mesmo lote. Reenviar a criação
  // nunca repõe nem duplica a etapa inicial personalizada depois pela equipe.
  const [, , salvo] = await db.batch([
    db
      .insert(funis)
      .select(sql`SELECT ${id}, ${setorId}, ${nome}, ${cor}
      WHERE ${gestor} AND EXISTS(SELECT 1 FROM setores WHERE id=${setorId})`)
      .onConflictDoNothing(),
    db
      .insert(etapas)
      .select(
        sql`SELECT ${crypto.randomUUID()}, ${id}, 'Novo', '#64748b', 1, NULL WHERE changes()=1`,
      ),
    db
      .select({ id: funis.id })
      .from(funis)
      .where(
        and(
          eq(funis.id, id),
          eq(funis.setorId, setorId),
          eq(funis.nome, nome),
          eq(funis.cor, cor),
          gestor,
        ),
      ),
  ])
  if (!salvo.length)
    throw new ErroEstrutura(
      'Setor indisponível ou cadastro anterior salvo com outros dados.',
    )
}

const etapaDeEntradaNecessaria = sql`etapas.fechamento IS NULL
  AND NOT EXISTS(SELECT 1 FROM etapas outra WHERE outra.funil_id=etapas.funil_id
    AND outra.fechamento IS NULL AND outra.id<>etapas.id)`
const etapaComNegocio = sql`EXISTS(SELECT 1 FROM negocios WHERE etapa_id=etapas.id)`

async function salvarEtapa(
  db: Banco,
  gestor: SQL,
  comando: Extract<ComandoEstrutura, { fechamento: Fechamento }>,
) {
  const id = texto(comando.id),
    nome = texto(comando.nome),
    funilId = texto(comando.funilId),
    cor = corValida(comando.cor)
  const { fechamento } = comando
  if (fechamento !== null && fechamento !== 'sucesso' && fechamento !== 'perda')
    throw new ErroEstrutura('Escolha um fechamento válido.')
  if (comando.tipo === 'criarEtapa') {
    confirmar(
      await db.run(sql`INSERT INTO etapas (id,funil_id,nome,cor,posicao,fechamento)
      SELECT ${id}, ${funilId}, ${nome}, ${cor}, (SELECT coalesce(max(posicao),0)+1 FROM etapas WHERE funil_id=${funilId}), ${fechamento}
      WHERE ${gestor} AND EXISTS(SELECT 1 FROM funis WHERE id=${funilId})
      ON CONFLICT(id) DO UPDATE SET id=excluded.id WHERE etapas.nome=excluded.nome
      AND etapas.cor=excluded.cor AND etapas.fechamento IS excluded.fechamento AND etapas.funil_id=excluded.funil_id`),
      conflito,
    )
    return
  }
  confirmar(
    await db
      .update(etapas)
      .set({ nome, cor, fechamento })
      .where(sql`id=${id} AND funil_id=${funilId} AND ${gestor}
    AND (fechamento IS ${fechamento} OR (NOT ${etapaComNegocio} AND NOT (${etapaDeEntradaNecessaria})))`),
    'Confira se a etapa ainda existe. Para mudar o fechamento, mova os negócios dela e preserve uma etapa aberta para a entrada.',
  )
}

async function ordenarEtapas(
  db: Banco,
  gestor: SQL,
  funilId: string,
  entrada: string[],
) {
  const funil = texto(funilId)
  const invalida = 'A lista de etapas mudou. Atualize a tela antes de ordenar.'
  if (!Array.isArray(entrada) || entrada.length === 0)
    throw new ErroEstrutura(invalida)
  const ids = entrada.map(texto)
  if (new Set(ids).size !== ids.length) throw new ErroEstrutura(invalida)
  // A lista completa é um único parâmetro D1. A condição impede aplicar metade
  // de uma ordem se a equipe criar ou apagar uma etapa durante o arraste.
  const ordem = JSON.stringify(ids)
  confirmar(
    await db.run(sql`WITH ordem AS (SELECT key+1 AS posicao,value AS id FROM json_each(${ordem}))
    UPDATE etapas SET posicao=(SELECT posicao FROM ordem WHERE ordem.id=etapas.id)
    WHERE funil_id=${funil} AND ${gestor} AND
      (SELECT count(*) FROM etapas WHERE funil_id=${funil})=${ids.length}
      AND NOT EXISTS(SELECT id FROM ordem EXCEPT SELECT id FROM etapas WHERE funil_id=${funil})`),
    invalida,
  )
}

export async function alterarEstrutura(
  db: Banco,
  usuarioId: string,
  comando: ComandoEstrutura,
) {
  const gestor = await exigirGestor(db, usuarioId)
  try {
    switch (comando?.tipo) {
      case 'criarSetor': {
        const id = texto(comando.id),
          nome = texto(comando.nome)
        confirmar(
          await db.run(sql`INSERT INTO setores (id,nome)
          SELECT ${id},${nome} WHERE ${gestor} ON CONFLICT(id) DO UPDATE SET id=excluded.id WHERE setores.nome=excluded.nome`),
          conflito,
        )
        return
      }
      case 'editarSetor': {
        confirmar(
          await db
            .update(setores)
            .set({ nome: texto(comando.nome) })
            .where(and(eq(setores.id, texto(comando.id)), gestor)),
          'Este setor já foi apagado.',
        )
        return
      }
      case 'apagarSetor': {
        const id = texto(comando.id)
        const [, restante] = await db.batch([
          db.delete(setores).where(sql`id=${id} AND ${gestor}
            AND NOT EXISTS(SELECT 1 FROM funis WHERE setor_id=setores.id)
            AND NOT EXISTS(SELECT 1 FROM pessoas_setores ps JOIN user u ON u.id=ps.usuario_id
              WHERE ps.setor_id=setores.id AND u.deleted_at IS NULL)
            AND NOT EXISTS(SELECT 1 FROM convites_setores cs JOIN convites c ON c.id=cs.convite_id
              WHERE cs.setor_id=setores.id AND c.aceito_em IS NULL)`),
          db.select({ id: setores.id }).from(setores).where(eq(setores.id, id)),
        ])
        if (restante.length)
          throw new ErroEstrutura(
            'Só é possível apagar um setor vazio. Confira os funis, números, pessoas e convites.',
          )
        return
      }
      case 'criarFunil':
        await criarFunil(db, gestor, comando)
        return
      case 'editarFunil':
        confirmar(
          await db
            .update(funis)
            .set({ nome: texto(comando.nome), cor: corValida(comando.cor) })
            .where(
              and(
                eq(funis.id, texto(comando.id)),
                eq(funis.setorId, texto(comando.setorId)),
                gestor,
              ),
            ),
          'Este funil já foi apagado ou pertence a outro setor.',
        )
        return
      case 'apagarFunil': {
        const id = texto(comando.id)
        const [, restante] = await db.batch([
          db.delete(funis).where(sql`id=${id} AND ${gestor}
            AND NOT EXISTS(SELECT 1 FROM negocios WHERE funil_id=funis.id)
            AND NOT EXISTS(SELECT 1 FROM numeros WHERE funil_padrao_id=funis.id)
            AND NOT (funis.id='pos' AND EXISTS(SELECT 1 FROM funis origem WHERE origem.id='vendas'))`),
          db.select({ id: funis.id }).from(funis).where(eq(funis.id, id)),
        ])
        if (restante.length)
          throw new ErroEstrutura(
            'O funil ainda recebe negócios, atende um número ou contém negócios no histórico.',
          )
        return
      }
      case 'criarEtapa':
      case 'editarEtapa':
        await salvarEtapa(db, gestor, comando)
        return
      case 'apagarEtapa': {
        const id = texto(comando.id)
        const [, restante] = await db.batch([
          db
            .delete(etapas)
            .where(
              sql`id=${id} AND ${gestor} AND NOT ${etapaComNegocio} AND NOT (${etapaDeEntradaNecessaria})`,
            ),
          db
            .select({ ocupada: sql<number>`${etapaComNegocio}` })
            .from(etapas)
            .where(eq(etapas.id, id)),
        ])
        if (restante[0]?.ocupada)
          throw new ErroEstrutura(
            'Esta etapa tem negócios e não pode ser apagada.',
          )
        if (restante.length)
          throw new ErroEstrutura(
            'Mantenha uma etapa aberta para receber novos negócios.',
          )
        return
      }
      case 'ordenarEtapas':
        await ordenarEtapas(db, gestor, comando.funilId, comando.ids)
        return
      case 'definirFunilPadrao': {
        const funilId = texto(comando.funilId),
          numeroId = texto(comando.numeroId)
        confirmar(
          await db
            .update(numeros)
            .set({ funilPadraoId: funilId })
            .where(sql`id=${numeroId} AND ${gestor}
          AND EXISTS(SELECT 1 FROM funis WHERE funis.id=${funilId} AND funis.setor_id=numeros.setor_id)
          AND EXISTS(SELECT 1 FROM etapas WHERE etapas.funil_id=${funilId} AND fechamento IS NULL)`),
          'Escolha um funil do setor do número que tenha uma etapa aberta.',
        )
        return
      }
      default:
        throw new ErroEstrutura('Operação inválida.')
    }
  } catch (erro) {
    if (erro instanceof ErroEstrutura) throw erro
    if (
      erro instanceof Error &&
      erro.cause instanceof Error &&
      erro.cause.message.includes(
        'UNIQUE constraint failed: etapas.funil_id, etapas.fechamento',
      )
    )
      throw new ErroEstrutura('O funil já tem uma etapa com esse fechamento.')
    throw new ErroEstrutura(
      'Não foi possível confirmar a alteração. Tente de novo.',
    )
  }
}
