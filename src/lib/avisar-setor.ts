import { env, waitUntil } from 'cloudflare:workers'

// O setor vem da projeção do número no D1. O objeto recebe só a chamada,
// sem o envelope do provedor, conteúdo da conversa ou credenciais da equipe.
export function agendarAvisoSetor(setorId: string) {
  waitUntil(
    (async () => {
      try {
        await env.TEMPO_REAL.getByName(setorId).avisar()
      } catch {
        console.warn('[tempo-real] Não foi possível avisar o setor.')
      }
    })(),
  )
}
