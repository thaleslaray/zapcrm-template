import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { getDb } from '#/db'
import { user } from '#/db/auth-schema'
import {
  contatos,
  contatosEtiquetas,
  conversas,
  etapas,
  etiquetas,
  funis,
  mensagens,
  negocios,
  notas,
  numeros,
  pedidosHistorico,
} from '#/db/schema'
import { setoresVisiveis } from '#/lib/acesso-crm'
import { retornosVisiveis } from './retornos-leitura'
import { resumoHistorico } from './wa-historico-resultado'
import { tipoInterativo } from './wa-interativa'

export type BancoConversas = ReturnType<typeof getDb>

function resumoMensagem(
  tipo: string | null,
  texto: string | null,
  arquivo: string | null = null,
) {
  if (texto) return texto
  switch (tipo?.toLowerCase()) {
    case 'foto':
    case 'imagemessage':
      return 'Foto'
    case 'audio':
    case 'audiomessage':
      return 'Áudio'
    case 'videomessage':
      return 'Vídeo'
    case 'stickermessage':
      return 'Figurinha'
    case 'documento':
    case 'documentwithcaptionmessage':
    case 'documentmessage':
      return arquivo ?? 'Documento'
    default:
      return tipo ? 'Mensagem' : null
  }
}

// ASVS 8.2.2: o número vem da decisão de acesso, nunca de uma lista enviada pela tela.
// Um parâmetro JSON também atende equipes com mais números que o limite de parâmetros do D1.
export async function numerosPermitidos(db: BancoConversas, usuario: string) {
  return numerosAtivos((await setoresVisiveis(db, usuario)).numeros)
}

function numerosAtivos(ids: string[]) {
  // Conversas abertas pela carteira antes da conexão também têm histórico.
  // Uma instância em provisionamento só fica disponível após confirmar o estado.
  return sql`(SELECT id FROM numeros WHERE id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))
    AND (estado_em IS NOT NULL OR (instancia_id IS NULL AND EXISTS (
      SELECT 1 FROM conversas cv WHERE cv.numero_id=numeros.id
    ))))`
}

export async function listarConversas(db: BancoConversas, usuario: string) {
  const acesso = await setoresVisiveis(db, usuario)
  const permitidos = numerosAtivos(acesso.numeros)
  const numerosVisiveis = sql`(SELECT value FROM json_each(${JSON.stringify(acesso.numeros)}))`
  const agora = Date.now()
  const atividade = sql`coalesce(max(${conversas.ultimaMensagemEm}, ${mensagens.instante}), ${conversas.ultimaMensagemEm}, ${mensagens.instante})`
  const [linhas, canais, rotulos, [contador]] = await Promise.all([
    db
      .select({
        id: conversas.id,
        contatoId: contatos.id,
        nome: contatos.nome,
        telefone: contatos.telefone,
        telefoneNormalizado: contatos.telefoneNormalizado,
        empresa: contatos.empresa,
        numeroId: numeros.id,
        naoLidas: conversas.naoLidas,
        ultimaEm: atividade.mapWith(conversas.ultimaMensagemEm),
        ultimaTexto: mensagens.texto,
        ultimaTipo: mensagens.tipo,
        ultimaEstado: mensagens.estado,
        ultimaDirecao: mensagens.direcao,
        ultimoArquivo: mensagens.arquivoNome,
        mensagemEm: mensagens.instante,
        previaEm: conversas.previaEm,
        previaTexto: conversas.previaTexto,
        previaTipo: conversas.previaTipo,
        previaDirecao: conversas.previaDirecao,
        etapa: etapas.nome,
        etapaCor: etapas.cor,
        funil: funis.nome,
        valorCentavos: negocios.valorCentavos,
        responsavel: user.name,
        responsavelId: negocios.responsavelId,
        atraso: sql<number>`EXISTS(${retornosVisiveis(sql`(${numeros.id})`, sql`r.contato_id = ${contatos.id} AND r.marcado_para < ${agora}`)})`,
      })
      .from(conversas)
      .innerJoin(numeros, eq(numeros.id, conversas.numeroId))
      .innerJoin(contatos, eq(contatos.id, conversas.contatoId))
      .leftJoin(
        mensagens,
        eq(
          mensagens.id,
          sql`(SELECT m.id FROM mensagens m WHERE m.conversa_id = ${conversas.id} AND coalesce(m.arquivo_bytes, 0) >= 0 ORDER BY m.instante DESC, m.rowid DESC LIMIT 1)`,
        ),
      )
      .leftJoin(
        negocios,
        eq(
          negocios.id,
          sql`(SELECT n.id FROM negocios n
        WHERE n.contato_id = ${contatos.id} AND n.funil_id = ${numeros.funilPadraoId}
        ORDER BY n.fechado_em IS NULL DESC, n.criado_em DESC, n.id LIMIT 1)`,
        ),
      )
      .leftJoin(etapas, eq(etapas.id, negocios.etapaId))
      .leftJoin(funis, eq(funis.id, negocios.funilId))
      .leftJoin(user, eq(user.id, negocios.responsavelId))
      .where(inArray(conversas.numeroId, permitidos))
      .orderBy(desc(atividade), asc(conversas.id)),
    db
      .select({
        id: numeros.id,
        nome: numeros.nome,
        telefone: numeros.telefone,
        cor: numeros.cor,
        estado: numeros.estado,
        sincronizando: numeros.sincronizandoHistorico,
      })
      .from(numeros)
      .where(inArray(numeros.id, permitidos))
      .orderBy(numeros.nome),
    db
      .select({
        id: etiquetas.id,
        nome: etiquetas.nome,
        contatoId: contatosEtiquetas.contatoId,
      })
      .from(contatosEtiquetas)
      .innerJoin(etiquetas, eq(etiquetas.id, contatosEtiquetas.etiquetaId))
      .where(
        inArray(
          contatosEtiquetas.contatoId,
          db
            .select({ id: conversas.contatoId })
            .from(conversas)
            .where(inArray(conversas.numeroId, permitidos)),
        ),
      ),
    db.all<{ total: number; proximo: number | null }>(
      sql`SELECT count(CASE WHEN marcadoPara < ${agora} THEN 1 END) AS total,
            min(CASE WHEN marcadoPara >= ${agora} THEN marcadoPara END) AS proximo
          FROM (${retornosVisiveis(numerosVisiveis)})`,
    ),
  ])
  const porContato = new Map<string, string[]>()
  for (const { contatoId, id } of rotulos) {
    const ids = porContato.get(contatoId) ?? []
    ids.push(id)
    porContato.set(contatoId, ids)
  }
  return {
    atrasados: contador.total,
    ateProximoRetorno:
      contador.proximo === null ? null : contador.proximo - agora,
    lista: linhas.map(
      ({
        mensagemEm,
        previaEm,
        previaTexto,
        previaTipo,
        previaDirecao,
        ...l
      }) => {
        const base = { ...l, tags: porContato.get(l.contatoId) ?? [] }
        const reacao = previaTipo === 'ReactionMessage'
        // O snapshot compacto pode omitir o corpo ou o voto que já chegou no histórico.
        const interativaGravada =
          previaEm?.getTime() === mensagemEm?.getTime() &&
          tipoInterativo(previaTipo ?? '') &&
          l.ultimaTexto &&
          l.ultimaTexto !== 'Mensagem não suportada'
        if (
          previaEm &&
          !reacao &&
          !interativaGravada &&
          (!mensagemEm || previaEm >= mensagemEm)
        ) {
          return {
            ...base,
            resumo: resumoMensagem(previaTipo, previaTexto),
            ultimaTexto: previaTexto,
            ultimaTipo: previaTipo,
            ultimaDirecao: previaDirecao,
            ultimaEstado: null,
            ultimoArquivo: null,
          }
        }
        return {
          ...base,
          resumo:
            reacao && !mensagemEm
              ? ''
              : resumoMensagem(l.ultimaTipo, l.ultimaTexto, l.ultimoArquivo),
        }
      },
    ),
    numeros: canais,
    etiquetas: Array.from(
      new Map(rotulos.map((r) => [r.id, r.nome])),
      ([id, nome]) => ({ id, nome }),
    ),
  }
}

export async function lerConversaComHistorico(
  db: BancoConversas,
  usuario: string,
  id: string,
) {
  const permitidos = await numerosPermitidos(db, usuario)
  const chatVisivel = and(
    eq(conversas.id, id),
    inArray(conversas.numeroId, permitidos),
  )
  const [alvo, lista, internas] = await Promise.all([
    db
      .select({
        estado: pedidosHistorico.estado,
        motivo: pedidosHistorico.motivo,
        iniciadoEm: pedidosHistorico.iniciadoEm,
      })
      .from(conversas)
      .leftJoin(pedidosHistorico, eq(pedidosHistorico.conversaId, conversas.id))
      .where(chatVisivel)
      .get(),
    db
      .select({
        id: mensagens.id,
        texto: mensagens.texto,
        interativa: mensagens.interativa,
        editada: mensagens.editada,
        tipo: mensagens.tipo,
        estado: mensagens.estado,
        direcao: mensagens.direcao,
        instante: mensagens.instante,
        tentativaEm: mensagens.tentativaEm,
        confirmada: sql<number>`${mensagens.identificador} IS NOT NULL`,
        nomeArquivo: mensagens.arquivoNome,
        bytes: mensagens.arquivoBytes,
        duracao: mensagens.duracaoSegundos,
        temArquivo: sql<number>`${mensagens.arquivoChave} IS NOT NULL`,
      })
      .from(mensagens)
      .where(
        and(
          eq(mensagens.conversaId, id),
          sql`coalesce(${mensagens.arquivoBytes}, 0) >= 0`,
          inArray(mensagens.numeroId, permitidos),
        ),
      )
      .orderBy(asc(mensagens.instante), sql`mensagens.rowid`),
    db
      .select({
        id: notas.id,
        texto: notas.texto,
        instante: notas.criadoEm,
        autorNome: user.name,
      })
      .from(notas)
      .innerJoin(
        conversas,
        and(
          eq(conversas.id, notas.conversaId),
          eq(conversas.contatoId, notas.contatoId),
        ),
      )
      .leftJoin(user, eq(user.id, notas.autorId))
      .where(chatVisivel)
      .orderBy(notas.criadoEm, notas.id),
  ])
  if (!alvo) throw new Error('Sem acesso a esta conversa.')
  const itens = [
    ...lista,
    ...internas.map((n) => ({ ...n, tipo: 'nota' as const })),
  ].sort((a, b) => a.instante.getTime() - b.instante.getTime())
  return {
    lista: itens,
    historico: resumoHistorico(alvo.estado, alvo.motivo, alvo.iniciadoEm),
  }
}

export async function lerChat(db: BancoConversas, usuario: string, id: string) {
  return (await lerConversaComHistorico(db, usuario, id)).lista
}

export async function marcarLida(
  db: BancoConversas,
  usuario: string,
  id: string,
) {
  const permitidos = await numerosPermitidos(db, usuario)
  const salvo = await db
    .update(conversas)
    .set({
      naoLidas: 0,
      naoLidasEm: sql`max(coalesce(${conversas.naoLidasEm},0), coalesce(${conversas.ultimaMensagemEm},0))`,
    })
    .where(and(eq(conversas.id, id), inArray(conversas.numeroId, permitidos)))
    .returning({ id: conversas.id })
  if (!salvo.length) throw new Error('Sem acesso a esta conversa.')
}

export type FilaConversas = Awaited<ReturnType<typeof listarConversas>>
export type LinhaConversa = FilaConversas['lista'][number]
export type ItemChat = Awaited<ReturnType<typeof lerChat>>[number]
export type MensagemChat = Exclude<ItemChat, { tipo: 'nota' }>
