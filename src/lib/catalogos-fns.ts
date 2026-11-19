import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { getDb } from '#/db'
import { getAuth } from './auth'
import {
  alterarCatalogo,
  type ComandoCatalogo,
  listarEtiquetasGestao,
  listarRespostas,
} from './catalogos'
import { exigirLogin } from './exigir-login'
import { limitarUsuario } from './rate-limit'
import { getRequestSession } from './request-session'
import { enforceAccess } from './session-access'

async function usuarioLeitura() {
  const sessao = await getRequestSession()
  if (!sessao) exigirLogin()
  await limitarUsuario(sessao.user.id, 'leitura')
  return sessao.user.id
}

export const listarEtiquetasGestaoFn = createServerFn({
  method: 'GET',
}).handler(async () =>
  listarEtiquetasGestao(getDb(env.DB), await usuarioLeitura()),
)
export const listarRespostasFn = createServerFn({ method: 'GET' }).handler(
  async () => listarRespostas(getDb(env.DB), await usuarioLeitura()),
)
export const alterarCatalogoFn = createServerFn({ method: 'POST' })
  .validator((comando: ComandoCatalogo) => comando)
  .handler(async ({ data }) => {
    const request = getRequest()
    const sessao = await enforceAccess(
      env,
      await getAuth(env, request).api.getSession({
        headers: request.headers,
        query: { disableCookieCache: true },
      }),
    )
    if (!sessao) exigirLogin()
    await limitarUsuario(sessao.user.id, 'escrita')
    await alterarCatalogo(getDb(env.DB), sessao.user.id, data)
  })
