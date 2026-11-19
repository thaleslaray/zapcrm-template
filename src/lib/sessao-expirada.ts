import { safeRedirect } from './safe-redirect'

export function verificarRespostaDaSessao(resposta: Response) {
  if (
    resposta.status === 401 &&
    typeof window !== 'undefined' &&
    /^\/app(?:\/|$)/.test(window.location.pathname)
  ) {
    const { pathname, search, hash } = window.location
    const destino = safeRedirect(pathname + search + hash)
    window.location.replace(
      `/login?${new URLSearchParams({ redirect: destino })}`,
    )
  }
  return resposta
}

export async function buscarComSessao(...args: Parameters<typeof fetch>) {
  return verificarRespostaDaSessao(await fetch(...args))
}
