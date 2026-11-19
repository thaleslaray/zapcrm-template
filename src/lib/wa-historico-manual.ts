import { and, eq, sql } from 'drizzle-orm'
import { pedidosHistorico } from '#/db/schema'
import { agendarAvisoSetor } from './avisar-setor'
import {
  AncoraIndisponivel,
  chamarInstancia,
  decifrarToken,
  objeto,
  UazapiErro,
} from './uazapi'
import { gravarHistorico } from './wa-avisos'
import type { BancoConversas } from './wa-conversas'
import { destinoDaConversa } from './wa-conversas-envio'
import { resumoHistorico } from './wa-historico-resultado'
import { obterServidor } from './wa-servidor'

export async function pedirHistorico(
  db: BancoConversas,
  vars: Env,
  usuario: string,
  conversaId: string,
) {
  const alvo = await destinoDaConversa(db, usuario, conversaId)
  if (!alvo.destino || !alvo.token) throw new Error('Número indisponível.')
  const condicao = eq(pedidosHistorico.conversaId, conversaId)
  const anterior = await db
    .select()
    .from(pedidosHistorico)
    .where(condicao)
    .get()
  const estado = resumoHistorico(
    anterior?.estado ?? null,
    anterior?.motivo ?? null,
    anterior?.iniciadoEm ?? null,
  ).estado
  if (!['mais', 'disponivel', 'expirado', 'falha'].includes(estado)) return

  const [servidor, token] = await Promise.all([
    obterServidor(db, vars),
    decifrarToken(vars.UAZAPI_CHAVE, alvo.token),
  ])
  if ((alvo.servidorOrigem ?? servidor.origemLegada) !== servidor.endereco)
    throw new Error('Religue este número no servidor atual.')
  const pedidoId = crypto.randomUUID()
  const valores = {
    pedidoId,
    iniciadoEm: Date.now(),
    estado: 'pendente' as const,
    motivo: null,
  }
  // A reserva precede o POST: o celular pode devolver o status antes da resposta HTTP.
  const vinculo = sql`EXISTS(SELECT 1 FROM numeros WHERE id=${alvo.numeroId} AND token_cifrado=${alvo.token})`
  const reserva = anterior
    ? await db
        .update(pedidosHistorico)
        .set(valores)
        .where(
          and(
            vinculo,
            condicao,
            eq(pedidosHistorico.pedidoId, anterior.pedidoId),
            eq(pedidosHistorico.estado, anterior.estado),
          ),
        )
        .returning({ id: pedidosHistorico.pedidoId })
    : await db
        .insert(pedidosHistorico)
        .select(
          sql`SELECT ${conversaId},${pedidoId},'pendente',${valores.iniciadoEm},NULL,NULL WHERE ${vinculo}`,
        )
        .onConflictDoNothing()
        .returning({ id: pedidosHistorico.pedidoId })
  if (!reserva.length) return
  const pendente = and(
    condicao,
    eq(pedidosHistorico.pedidoId, pedidoId),
    eq(pedidosHistorico.estado, 'pendente'),
  )
  let enviouPedido = false
  try {
    try {
      // Todo pedido relê primeiro o que a instância guarda desta conversa: é o
      // que traz botões, edições e mensagens que faltavam, mesmo que o celular
      // não responda ao pedido de anteriores.
      const pagina = objeto(
        await chamarInstancia(servidor.endereco, token, '/message/find', {
          chatid: alvo.destino,
          limit: 20,
          offset: 0,
        }),
      )
      if (!Array.isArray(pagina.messages))
        throw new Error('Página indisponível.')
      const atuais = pagina.messages.slice(0, 20).filter((valor) => {
        const m = objeto(valor)
        return m.chatid === alvo.destino || m.chatlid === alvo.destino
      })
      await gravarHistorico(
        vars,
        alvo.numeroId,
        { endereco: servidor.endereco, token, vinculo: alvo.token },
        atuais,
      )
    } catch (erro) {
      // Na primeira vez a releitura é parte do pedido. Depois, uma falha dela
      // não impede pedir as mensagens anteriores ao celular.
      if (!anterior) throw erro
    }
    enviouPedido = true
    const resposta = objeto(
      await chamarInstancia(servidor.endereco, token, '/message/history-sync', {
        ...(anterior?.proximo ?? { number: alvo.destino, count: 50 }),
        requestId: pedidoId,
      }),
    )
    if (
      typeof resposta.request_id !== 'string' ||
      !resposta.request_id ||
      resposta.request_id.length > 255
    )
      throw new Error('Pedido sem confirmação.')
    if (resposta.request_id !== pedidoId)
      await db
        .update(pedidosHistorico)
        .set({ pedidoId: resposta.request_id })
        .where(pendente)
  } catch (erro) {
    const recusado =
      !enviouPedido ||
      (erro instanceof UazapiErro && erro.status >= 400 && erro.status < 500)
    await db
      .update(pedidosHistorico)
      .set(
        erro instanceof AncoraIndisponivel
          ? { estado: 'bloqueado', motivo: 'anchor_unavailable', proximo: null }
          : { estado: recusado ? 'falha' : 'incerto' },
      )
      .where(pendente)
  }
  agendarAvisoSetor(alvo.setorId)
}
