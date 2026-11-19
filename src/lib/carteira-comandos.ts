import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { getDb } from '#/db'
import { getAuth } from '#/lib/auth'
import { type ComandoCarteira, executarComando } from '#/lib/carteira-escrita'
import { limitarUsuario } from '#/lib/rate-limit'
import { enforceAccess } from '#/lib/session-access'
import { exigirLogin } from './exigir-login'

export type { ComandoCarteira } from '#/lib/carteira-escrita'

export const executarComandoFn = createServerFn({ method: 'POST' })
  .validator((entrada: ComandoCarteira) => entrada)
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
    try {
      return await executarComando(
        getDb(env.DB),
        env.BUCKET,
        sessao.user.id,
        data,
      )
    } catch {
      // O erro original do Drizzle inclui os parâmetros da consulta: são dados pessoais.
      throw new Error('Não foi possível confirmar a gravação. Tente de novo.')
    }
  })
