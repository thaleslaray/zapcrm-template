import { and, asc, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm'
import { appConfig } from '#/config/app'
import { getDb } from '#/db'
import { numeros } from '#/db/schema'
import {
  chamarInstancia,
  decifrarToken,
  objeto,
  segredoConfere,
} from './uazapi'
import { reconciliarNumero } from './wa-numeros-historico'
import { obterServidor } from './wa-servidor'

// Mantém espaço no cron para os expurgos e o lembrete de encerramento.
const NUMEROS_POR_EXECUCAO = 5
const saudeRuim = new Set(['slow', 'very_slow', 'failing', 'disabled'])

async function webhookParaReligar(
  lista: unknown,
  origem: string,
  numero: string,
  resumo: string,
) {
  if (!Array.isArray(lista)) return
  const caminho = `/api/whatsapp/aviso/${encodeURIComponent(numero)}/`
  for (const item of lista) {
    const w = objeto(item)
    const estado = objeto(w.health).status
    if (
      w.enabled !== false &&
      !(typeof estado === 'string' && saudeRuim.has(estado))
    )
      continue
    if (typeof w.url !== 'string' || !URL.canParse(w.url)) continue
    const url = new URL(w.url)
    // No dev a origem pode ter vindo do pedido de pareamento. No cron só a
    // aceitamos sem configuração explícita para um receptor de loopback.
    const local =
      !origem &&
      import.meta.env.DEV &&
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    const prefixo = `${local ? url.origin : origem || appConfig.url}${caminho}`
    if (!w.url.startsWith(prefixo)) continue
    if (!(await segredoConfere(w.url.slice(prefixo.length), resumo))) continue
    // Sem ID só é seguro usar o modo simples quando há um único webhook.
    const id = typeof w.id === 'string' && w.id ? w.id : undefined
    if (!id && lista.length !== 1) continue
    return {
      ...(id ? { id, action: 'update' } : {}),
      enabled: true,
      url: w.url,
      events: w.events,
      excludeMessages: w.excludeMessages,
      addUrlEvents: w.addUrlEvents,
      addUrlTypesMessages: w.addUrlTypesMessages,
    }
  }
}

export async function verificarWebhooks(env: Env) {
  const db = getDb(env.DB)
  const agora = Date.now()
  const inicioDia = new Date(agora - (agora % 86_400_000))
  const proximos = db
    .select({ id: numeros.id })
    .from(numeros)
    .where(
      and(
        eq(numeros.estado, 'conectado'),
        isNotNull(numeros.tokenCifrado),
        isNotNull(numeros.segredoWebhookHash),
        or(
          isNull(numeros.webhookVerificadoEm),
          lt(numeros.webhookVerificadoEm, inicioDia),
        ),
      ),
    )
    .orderBy(asc(numeros.webhookVerificadoEm), asc(numeros.id))
    .limit(NUMEROS_POR_EXECUCAO)
  const lote = await db
    .update(numeros)
    .set({ webhookVerificadoEm: new Date(agora) })
    .where(inArray(numeros.id, proximos))
    .returning({
      id: numeros.id,
      cifra: numeros.tokenCifrado,
      resumo: numeros.segredoWebhookHash,
      origem: numeros.servidorOrigem,
    })
  if (!lote.length) return 'verificados=0'
  const servidor = await obterServidor(db, env)
  const origem = env.BETTER_AUTH_URL ? new URL(env.BETTER_AUTH_URL).origin : ''
  let falhas = 0
  let verificados = 0
  for (const n of lote) {
    if (
      !n.cifra ||
      !n.resumo ||
      (n.origem ?? servidor.origemLegada) !== servidor.endereco
    )
      continue
    try {
      const credencial = {
        endereco: servidor.endereco,
        vinculo: n.cifra,
        token: await decifrarToken(env.UAZAPI_CHAVE, n.cifra),
      }
      const lista = await chamarInstancia(
        credencial.endereco,
        credencial.token,
        '/webhook',
      )
      const webhook = await webhookParaReligar(lista, origem, n.id, n.resumo)
      const vinculo = and(
        eq(numeros.id, n.id),
        eq(numeros.estado, 'conectado'),
        eq(numeros.tokenCifrado, n.cifra),
        eq(numeros.segredoWebhookHash, n.resumo),
      )
      if (webhook) {
        // Salvar limpa a saúde no provedor. Se o pedido ou o Worker cair depois,
        // a pendência sobrevive e a próxima verificação retoma a varredura.
        const reserva = await db
          .update(numeros)
          .set({ webhookReconciliacaoPendente: true })
          .where(vinculo)
        if (!reserva.meta.changes) continue
        await chamarInstancia(
          credencial.endereco,
          credencial.token,
          '/webhook',
          webhook,
        )
      }
      verificados++
    } catch {
      // Erro de um destino não impede a verificação dos outros números.
      falhas++
    }
  }
  if (falhas)
    throw new Error(`Falha ao verificar ${falhas} webhook(s) do WhatsApp.`)
  return `verificados=${verificados}`
}

export async function reconciliarNumeroDoDia(env: Env) {
  const db = getDb(env.DB)
  const agora = Date.now()
  const inicioDia = new Date(agora - (agora % 86_400_000))
  // O diagnóstico conserva seu lote de cinco números. A varredura (que pode
  // conter mídia) recebe um único número, em ordem de última tentativa.
  const proximaVarredura = db
    .select({ id: numeros.id })
    .from(numeros)
    .where(
      and(
        eq(numeros.estado, 'conectado'),
        isNotNull(numeros.tokenCifrado),
        isNotNull(numeros.segredoWebhookHash),
        or(
          isNull(numeros.reconciliacaoEm),
          lt(numeros.reconciliacaoEm, inicioDia),
        ),
      ),
    )
    .orderBy(asc(numeros.reconciliacaoEm), asc(numeros.id))
    .limit(1)
  const [alvo] = await db
    .update(numeros)
    .set({ reconciliacaoEm: new Date(agora) })
    .where(inArray(numeros.id, proximaVarredura))
    .returning({
      id: numeros.id,
      cifra: numeros.tokenCifrado,
      origem: numeros.servidorOrigem,
    })
  if (!alvo?.cifra) return
  const servidor = await obterServidor(db, env)
  if ((alvo.origem ?? servidor.origemLegada) !== servidor.endereco) return
  const resultado = await reconciliarNumero(env, alvo.id, {
    endereco: servidor.endereco,
    token: await decifrarToken(env.UAZAPI_CHAVE, alvo.cifra),
    vinculo: alvo.cifra,
  })
  await db
    .update(numeros)
    .set({ webhookReconciliacaoPendente: resultado.pendente })
    .where(and(eq(numeros.id, alvo.id), eq(numeros.tokenCifrado, alvo.cifra)))
}
