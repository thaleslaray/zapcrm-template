import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { getDb } from '#/db'
import { setoresVisiveis } from '#/lib/acesso-crm'
import { limitarUsuario } from '#/lib/rate-limit'
import { getRequestSession } from '#/lib/request-session'
import { exigirLogin } from './exigir-login'

export const acessoCrmFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const sessao = await getRequestSession()
    if (!sessao) exigirLogin()
    await limitarUsuario(sessao.user.id, 'leitura')
    return setoresVisiveis(getDb(env.DB), sessao.user.id)
  },
)
