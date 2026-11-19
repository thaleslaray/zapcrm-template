import { env } from 'cloudflare:workers'
import handler from '@tanstack/react-start/server-entry'
// Registra o sink da auditoria no D1 (audit_log). Sem esta linha, audit() é no-op.
import '#/lib/audit-d1'
// Registra o que cada módulo faz ao encerrar a conta e no "baixar meus dados".
import '#/lib/account-handlers'
import {
  bookmarkFromRequest,
  runWithD1Session,
  withD1Bookmark,
} from '#/db/d1-session'
import { D1_TRACE_HEADER, rastrearD1 } from '#/db/d1-trace'
import { runJobs } from '#/lib/jobs'
import { registrarErro } from '#/lib/log-erro'
import { isAssetPath, missingAssetResponse } from '#/lib/missing-asset'
import { linhaDeDesempenho, perfLogLigado } from '#/lib/perf-log'
import { isCrossSiteServerFnCall } from '#/lib/same-origin'
import { withSecurityHeaders } from '#/lib/security-headers'
import { conectarSetor } from '#/lib/tempo-real-acesso'
import { CABECALHO_TEMPO_REAL } from '#/lib/tempo-real-protocolo'
import { receberWebhook, retomarAvisos } from '#/lib/wa-avisos-receptor'
import { servirFotoContato } from '#/lib/wa-foto-contato'
import { servirMidia } from '#/lib/wa-midia'
import { reconciliarNumeroDoDia } from '#/lib/wa-webhook-saude'

export { TempoRealSetor } from '#/lib/tempo-real-setor'

export default {
  async fetch(request, _bindings, ctx) {
    const caminho = new URL(request.url).pathname
    const canal = /^\/api\/tempo-real\/([\w-]{1,128})$/.exec(caminho)
    // O upgrade precisa conservar o WebSocket da resposta 101. A autorização
    // lê o primário antes de criar a sessão D1 que aceita réplicas.
    if (canal) return conectarSetor(env, request, canal[1])
    // O endereço de aviso leva um segredo. Retorna antes da instrumentação
    // que registra o caminho de páginas e server functions.
    if (caminho.startsWith('/api/whatsapp/aviso/')) {
      try {
        const resposta = await receberWebhook(env, request, (p) =>
          ctx.waitUntil(p),
        )
        return withSecurityHeaders(resposta, request)
      } catch {
        console.error('[whatsapp] Falha ao aceitar aviso.')
        return new Response(null, {
          status: 503,
          headers: { 'cache-control': 'no-store' },
        })
      }
    }
    const foto = /^\/api\/contatos\/([\w-]{1,128})\/foto$/.exec(caminho)
    if (foto) {
      if (request.method !== 'GET') return new Response(null, { status: 405 })
      const origensDeTeste =
        import.meta.env.DEV && import.meta.env.VITE_E2E_SEM_LIMITE === '1'
          ? ['http://127.0.0.1:3233']
          : undefined
      return withSecurityHeaders(
        await servirFotoContato(env, request, foto[1], origensDeTeste),
        request,
      )
    }
    const midia = /^\/api\/whatsapp\/midia\/([\w-]{1,128})$/.exec(caminho)
    if (midia) {
      if (request.method !== 'GET') return new Response(null, { status: 405 })
      return withSecurityHeaders(
        await servirMidia(env, request, midia[1]),
        request,
      )
    }
    // Server functions só aceitam chamadas da própria origem (defesa contra CSRF).
    if (isCrossSiteServerFnCall(request)) {
      return withSecurityHeaders(
        new Response('Requisição cross-site recusada.', { status: 403 }),
        request,
      )
    }
    // /assets/<arquivo> que a camada de assets não achou (um arquivo de antes do
    // último deploy): 404 de verdade, nunca o HTML do app. Veja missing-asset.ts.
    if (isAssetPath(new URL(request.url).pathname)) {
      return withSecurityHeaders(missingAssetResponse(), request)
    }
    // Uma sessão D1 por pedido (Sessions API), compartilhada por todo `getDb`
    // chamado durante ele. O cookie `d1-bookmark` do pedido anterior garante que
    // quem acabou de escrever leia a própria escrita, mesmo vindo de uma réplica.
    const session = env.DB.withSession(
      request.method === 'GET' &&
        caminho.startsWith('/_serverFn/') &&
        request.headers.get(CABECALHO_TEMPO_REAL) === '1'
        ? 'first-primary'
        : (bookmarkFromRequest(request) ?? 'first-unconstrained'),
    )
    // Registro de desempenho (`PERF_LOG`, src/lib/perf-log.ts): desligado, não
    // embrulha nada e só custa esta comparação.
    const perf = perfLogLigado(env.PERF_LOG)
    const inicio = perf ? performance.now() : 0
    // Só em dev e com o header `x-d1-trace: 1`: imprime cada ida ao D1.
    const devTrace =
      import.meta.env.DEV && request.headers.get(D1_TRACE_HEADER) === '1'
    const trace =
      perf || devTrace
        ? rastrearD1(
            session,
            `${request.method} ${new URL(request.url).pathname}`,
            { log: devTrace },
          )
        : null
    const rotulo = `${request.method} ${new URL(request.url).pathname}`
    let res: Response
    try {
      res = await runWithD1Session(trace?.sessao ?? session, () =>
        handler.fetch(request),
      )
    } catch (erro) {
      // Exceção que escapou do handler: sem isto o Worker devolve um 500 mudo.
      registrarErro(rotulo, erro)
      throw erro
    }
    // O TanStack responde 500 sem escrever nada quando um loader falha. A causa
    // sai do middleware de src/start.ts; esta linha garante o rastro do pedido.
    if (res.status >= 500) console.error(`[500] ${rotulo}`)
    trace?.fim()
    if (perf && trace) {
      console.log(
        linhaDeDesempenho({
          method: request.method,
          url: request.url,
          status: res.status,
          ms: performance.now() - inicio,
          colo: (request as { cf?: { colo?: string } }).cf?.colo,
          idas: trace.idas(),
        }),
      )
    }
    return withSecurityHeaders(withD1Bookmark(res, session, request), request)
  },
  async scheduled(event, env, ctx) {
    console.log('[cron]', event.cron)
    if (event.cron === '5 3 * * *') {
      ctx.waitUntil(
        reconciliarNumeroDoDia(env).catch(() => {
          console.error(
            '[whatsapp] Não foi possível concluir a varredura diária.',
          )
        }),
      )
      return
    }
    if (event.cron !== '0 3 * * *') return
    ctx.waitUntil(
      retomarAvisos(env).catch(() =>
        console.error('[whatsapp] Não foi possível retomar os avisos.'),
      ),
    )
    ctx.waitUntil(
      runJobs(env).then((result) =>
        console.log('[cron] jobs:', JSON.stringify(result)),
      ),
    )
  },
} satisfies ExportedHandler<Env>
