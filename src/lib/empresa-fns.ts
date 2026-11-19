import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { getDb } from '#/db'
import { getAuth } from './auth'
import { resolveBaseURL } from './auth-config'
import { alterarEquipe, type ComandoEquipe, listarEquipe } from './equipe'
import {
  alterarEstrutura,
  type ComandoEstrutura,
  listarEstrutura,
} from './estrutura'
import { exigirLogin } from './exigir-login'
import { limitarUsuario } from './rate-limit'
import { getRequestSession } from './request-session'
import { enforceAccess } from './session-access'

async function usuarioDaEmpresa(operacao: 'leitura' | 'escrita') {
  const request = getRequest()
  const sessao =
    operacao === 'leitura'
      ? await getRequestSession()
      : await enforceAccess(
          env,
          await getAuth(env, request).api.getSession({
            headers: request.headers,
            query: { disableCookieCache: true },
          }),
        )
  if (!sessao) exigirLogin()
  await limitarUsuario(sessao.user.id, operacao)
  return sessao.user.id
}

export const listarEstruturaFn = createServerFn({ method: 'GET' }).handler(
  async () => listarEstrutura(getDb(env.DB), await usuarioDaEmpresa('leitura')),
)
export const listarEquipeFn = createServerFn({ method: 'GET' }).handler(
  async () => listarEquipe(getDb(env.DB), await usuarioDaEmpresa('leitura')),
)
export const alterarEstruturaFn = createServerFn({ method: 'POST' })
  .validator((data: ComandoEstrutura) => data)
  .handler(async ({ data }) =>
    alterarEstrutura(getDb(env.DB), await usuarioDaEmpresa('escrita'), data),
  )
export const alterarEquipeFn = createServerFn({ method: 'POST' })
  .validator((data: ComandoEquipe) => data)
  .handler(async ({ data }) => {
    const usuario = await usuarioDaEmpresa('escrita')
    const endereco = new URL(
      '/login',
      resolveBaseURL(env.BETTER_AUTH_URL, getRequest()),
    ).href
    return alterarEquipe(getDb(env.DB), usuario, data, endereco)
  })
