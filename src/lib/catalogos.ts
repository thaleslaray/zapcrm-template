import { and, count, eq } from 'drizzle-orm'
import type { getDb } from '#/db'
import { contatosEtiquetas, etiquetas, respostasRapidas } from '#/db/schema'
import { setoresVisiveis } from './acesso-crm'

type Banco = ReturnType<typeof getDb>
export type ComandoCatalogo =
  | {
      tipo: 'criarEtiqueta' | 'editarEtiqueta'
      id: string
      nome: string
      cor: string
    }
  | {
      tipo: 'criarResposta' | 'editarResposta'
      id: string
      atalho: string
      texto: string
    }
  | { tipo: 'apagarEtiqueta' | 'apagarResposta'; id: string }
  | {
      tipo: 'vincularEtiqueta'
      id: string
      contatoId: string
      presente: boolean
    }

class ErroCatalogo extends Error {}
function texto(valor: unknown, max: number) {
  if (typeof valor !== 'string' || !valor.trim() || valor.length > max)
    throw new ErroCatalogo('Confira os campos e tente de novo.')
  return valor.trim()
}
async function conferirAcesso(db: Banco, usuarioId: string, gestor: boolean) {
  const acesso = await setoresVisiveis(db, usuarioId)
  if (gestor && acesso.papel !== 'gestor') throw new ErroCatalogo('Sem acesso')
  if (acesso.papel !== 'gestor' && !acesso.setores.length)
    throw new ErroCatalogo('Aguardando o gestor liberar um setor para você')
}
export async function listarEtiquetasGestao(db: Banco, usuarioId: string) {
  await conferirAcesso(db, usuarioId, true)
  return db
    .select({
      id: etiquetas.id,
      nome: etiquetas.nome,
      cor: etiquetas.cor,
      contatos: count(contatosEtiquetas.contatoId),
    })
    .from(etiquetas)
    .leftJoin(contatosEtiquetas, eq(etiquetas.id, contatosEtiquetas.etiquetaId))
    .groupBy(etiquetas.id)
    .orderBy(etiquetas.nome)
}

export async function listarRespostas(db: Banco, usuarioId: string) {
  await conferirAcesso(db, usuarioId, false)
  return db.select().from(respostasRapidas).orderBy(respostasRapidas.atalho)
}

export async function alterarCatalogo(
  db: Banco,
  usuarioId: string,
  comando: ComandoCatalogo,
) {
  await conferirAcesso(db, usuarioId, comando?.tipo !== 'vincularEtiqueta')
  const id = texto(comando?.id, 100)
  try {
    switch (comando.tipo) {
      case 'vincularEtiqueta': {
        const contatoId = texto(comando.contatoId, 100)
        if (typeof comando.presente !== 'boolean')
          throw new ErroCatalogo('Escolha uma etiqueta.')
        if (comando.presente)
          await db
            .insert(contatosEtiquetas)
            .values({ contatoId, etiquetaId: id })
            .onConflictDoNothing()
        else
          await db
            .delete(contatosEtiquetas)
            .where(
              and(
                eq(contatosEtiquetas.contatoId, contatoId),
                eq(contatosEtiquetas.etiquetaId, id),
              ),
            )
        return
      }
      case 'criarEtiqueta':
      case 'editarEtiqueta': {
        const nome = texto(comando.nome, 80),
          cor = texto(comando.cor, 7)
        if (!/^#[0-9a-f]{6}$/i.test(cor))
          throw new ErroCatalogo('Escolha uma cor válida.')
        if (comando.tipo === 'criarEtiqueta') {
          const resultado = await db
            .insert(etiquetas)
            .values({ id, nome, cor })
            .onConflictDoUpdate({
              target: etiquetas.id,
              set: { id },
              setWhere: and(eq(etiquetas.nome, nome), eq(etiquetas.cor, cor)),
            })
          if (!resultado.meta.changes)
            throw new ErroCatalogo(
              'O cadastro anterior já foi salvo com outros dados. Feche e use Editar.',
            )
        } else {
          const r = await db
            .update(etiquetas)
            .set({ nome, cor })
            .where(eq(etiquetas.id, id))
          if (!r.meta.changes)
            throw new ErroCatalogo('Esta etiqueta já foi apagada.')
        }
        return
      }
      case 'criarResposta':
      case 'editarResposta': {
        const atalho = texto(comando.atalho, 50).toLowerCase(),
          corpo = texto(comando.texto, 16000)
        if (!/^\/[\p{L}\p{N}_-]+$/u.test(atalho))
          throw new ErroCatalogo(
            'Use um atalho com / seguido de letras, números, hífen ou sublinhado.',
          )
        if (comando.tipo === 'criarResposta') {
          const resultado = await db
            .insert(respostasRapidas)
            .values({ id, atalho, texto: corpo })
            .onConflictDoUpdate({
              target: respostasRapidas.id,
              set: { id },
              setWhere: and(
                eq(respostasRapidas.atalho, atalho),
                eq(respostasRapidas.texto, corpo),
              ),
            })
          if (!resultado.meta.changes)
            throw new ErroCatalogo(
              'O cadastro anterior já foi salvo com outros dados. Feche e use Editar.',
            )
        } else {
          const r = await db
            .update(respostasRapidas)
            .set({ atalho, texto: corpo })
            .where(eq(respostasRapidas.id, id))
          if (!r.meta.changes)
            throw new ErroCatalogo('Esta resposta já foi apagada.')
        }
        return
      }
      case 'apagarResposta':
        await db.delete(respostasRapidas).where(eq(respostasRapidas.id, id))
        return
      case 'apagarEtiqueta':
        await db.delete(etiquetas).where(eq(etiquetas.id, id))
        return
      default:
        throw new ErroCatalogo('Operação inválida.')
    }
  } catch (erro) {
    if (erro instanceof ErroCatalogo) throw erro
    if (
      erro instanceof Error &&
      erro.cause instanceof Error &&
      erro.cause.message.includes('UNIQUE constraint failed')
    )
      throw new ErroCatalogo('Esse cadastro já existe.')
    throw new ErroCatalogo(
      'Não foi possível confirmar a alteração. Tente de novo.',
    )
  }
}
