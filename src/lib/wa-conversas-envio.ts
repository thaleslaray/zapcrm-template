import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { conversas, mensagens, numeros } from '#/db/schema'
import { agendarAvisoSetor } from '#/lib/avisar-setor'
import { chamarInstancia, decifrarToken, objeto } from '#/lib/uazapi'
import {
  estadoDaMensagem,
  identificadorMensagem,
} from '#/lib/wa-avisos-formato'
import { type BancoConversas, numerosPermitidos } from '#/lib/wa-conversas'
import { PRAZO_REENVIO_MS } from '#/lib/wa-reenvio'
import { marcaReentrega } from './wa-mensagens-excluidas'
import { obterServidor } from './wa-servidor'

export type PedidoTexto = {
  conversaId: string
  id: string
  texto: string
  repetir: boolean
}

export async function destinoDaConversa(
  db: BancoConversas,
  usuario: string,
  conversaId: string,
) {
  const permitidos = await numerosPermitidos(db, usuario)
  const alvo = await db
    .select({
      id: conversas.id,
      numeroId: numeros.id,
      setorId: numeros.setorId,
      destino: sql<string | null>`coalesce(${conversas.jid},${conversas.lid})`,
      token: numeros.tokenCifrado,
      servidorOrigem: numeros.servidorOrigem,
    })
    .from(conversas)
    .innerJoin(numeros, eq(numeros.id, conversas.numeroId))
    .where(
      and(
        eq(conversas.id, conversaId),
        inArray(numeros.id, permitidos),
        isNotNull(numeros.estadoEm),
      ),
    )
    .get()
  if (!alvo) throw new Error('Sem acesso a esta conversa.')
  return alvo
}

export async function enviarTexto(
  db: BancoConversas,
  vars: Parameters<typeof obterServidor>[1],
  usuario: string,
  pedido: PedidoTexto,
) {
  const alvo = await destinoDaConversa(db, usuario, pedido.conversaId)
  const agora = new Date()
  const mesmaMensagem = and(
    eq(mensagens.id, pedido.id),
    eq(mensagens.conversaId, alvo.id),
    eq(mensagens.numeroId, alvo.numeroId),
    eq(mensagens.direcao, 'enviada'),
    eq(mensagens.tipo, 'texto'),
    eq(mensagens.texto, pedido.texto),
  )
  const reserva = await db
    .insert(mensagens)
    .values({
      id: pedido.id,
      conversaId: alvo.id,
      numeroId: alvo.numeroId,
      tipo: 'texto',
      direcao: 'enviada',
      estado: 'fila',
      texto: pedido.texto,
      instante: agora,
      tentativaEm: agora,
    })
    .onConflictDoNothing()
    .returning({ id: mensagens.id })

  return transmitirMensagem(db, vars, alvo, {
    id: pedido.id,
    mesmaMensagem,
    nova: reserva.length > 0,
    repetir: pedido.repetir,
    agora,
    requisicao: async () => ({
      caminho: '/send/text',
      corpo: { text: pedido.texto },
    }),
  })
}

type Destino = Awaited<ReturnType<typeof destinoDaConversa>>

export async function transmitirMensagem(
  db: BancoConversas,
  vars: Parameters<typeof obterServidor>[1],
  alvo: Destino,
  pedido: {
    id: string
    mesmaMensagem: SQL | undefined
    nova: boolean
    repetir: boolean
    agora: Date
    requisicao: () => Promise<{ caminho: string; corpo: object }>
  },
) {
  const { mesmaMensagem, agora } = pedido
  // A tentativa tem um dono. Se o Worker parar entre o POST e a gravação,
  // outra tentativa só retoma depois de expirar e de consultar o provedor.
  let estadoAnterior: typeof mensagens.$inferSelect.estado = 'fila'
  if (!pedido.nova) {
    let retomou = false
    if (pedido.repetir) {
      const anterior = await db
        .select({ estado: mensagens.estado })
        .from(mensagens)
        .where(mesmaMensagem)
        .get()
      if (!anterior) throw new Error('Não foi possível identificar a mensagem.')
      estadoAnterior = anterior.estado
      const [mudou] = await db
        .update(mensagens)
        .set({ estado: 'fila', tentativaEm: agora })
        .where(
          and(
            mesmaMensagem,
            eq(mensagens.estado, estadoAnterior),
            or(
              eq(mensagens.estado, 'falha'),
              and(
                eq(mensagens.estado, 'fila'),
                or(
                  isNull(mensagens.tentativaEm),
                  lt(
                    mensagens.tentativaEm,
                    new Date(agora.getTime() - PRAZO_REENVIO_MS),
                  ),
                ),
              ),
            ),
          ),
        )
        .returning({ id: mensagens.id })
      retomou = !!mudou
    }
    if (!retomou) {
      const existente = await db
        .select({ estado: mensagens.estado })
        .from(mensagens)
        .where(mesmaMensagem)
        .get()
      if (!existente)
        throw new Error('Não foi possível identificar a mensagem.')
      return existente.estado
    }
  }
  try {
    if (!alvo.token || !alvo.destino) throw new Error('Número indisponível.')
    const [servidor, token] = await Promise.all([
      obterServidor(db, vars),
      decifrarToken(vars.UAZAPI_CHAVE, alvo.token),
    ])
    if ((alvo.servidorOrigem ?? servidor.origemLegada) !== servidor.endereco)
      throw new Error('Religue este número no servidor atual.')
    const correlacao = { track_source: 'zapcrm', track_id: pedido.id }
    let enviado: unknown
    if (!pedido.nova) {
      const pagina = objeto(
        await chamarInstancia(servidor.endereco, token, '/message/find', {
          ...correlacao,
          limit: 10,
        }),
      )
      if (!Array.isArray(pagina.messages))
        throw new Error('Consulta de envio indisponível.')
      enviado = pagina.messages.find(
        (m) =>
          objeto(m).track_id === pedido.id &&
          objeto(m).track_source === 'zapcrm',
      )
    }
    if (!enviado) {
      const { caminho, corpo } = await pedido.requisicao()
      enviado = await chamarInstancia(servidor.endereco, token, caminho, {
        ...correlacao,
        number: alvo.destino,
        ...corpo,
      })
    }
    const identificador = identificadorMensagem(enviado)
    if (!identificador) throw new Error('Envio pendente de confirmação.')
    const bruto = objeto(enviado)
    const estado = estadoDaMensagem(bruto.status)
    await db
      .update(mensagens)
      .set({
        identificador,
        marcaReentrega: marcaReentrega(alvo.numeroId, identificador),
        identificadorProvedor: typeof bruto.id === 'string' ? bruto.id : null,
        estado: sql`CASE
          WHEN estado='lida' OR ${estado}='lida' THEN 'lida'
          WHEN estado='entregue' OR ${estado}='entregue' THEN 'entregue'
          WHEN ${estado} IS NULL THEN CASE WHEN estado='fila' THEN ${estadoAnterior} ELSE estado END
          WHEN estado='falha' AND identificador IS NOT NULL THEN 'falha'
          WHEN estado='enviada' AND ${estado}='fila' THEN estado ELSE ${estado} END`,
      })
      .where(mesmaMensagem)
  } catch {
    // Um eco pode ter confirmado o envio enquanto a resposta HTTP se perdeu.
    await db
      .update(mensagens)
      .set({ estado: 'falha' })
      .where(
        and(
          mesmaMensagem,
          eq(mensagens.estado, 'fila'),
          isNull(mensagens.identificador),
          eq(mensagens.tentativaEm, agora),
        ),
      )
  }
  await db
    .update(conversas)
    .set({
      ultimaMensagemEm: sql`(SELECT max(instante) FROM mensagens WHERE conversa_id=${alvo.id})`,
    })
    .where(eq(conversas.id, alvo.id))
  const salvo = await db
    .select({ estado: mensagens.estado })
    .from(mensagens)
    .where(mesmaMensagem)
    .get()
  if (!salvo) throw new Error('Não foi possível identificar a mensagem.')
  agendarAvisoSetor(alvo.setorId)
  return salvo.estado
}
