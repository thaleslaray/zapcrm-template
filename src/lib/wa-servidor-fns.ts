import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { exigirLogin } from './exigir-login'
import { limitarUsuario } from './rate-limit'
import { getRequestSession } from './request-session'
import { ErroServidor, removerServidor, salvarServidor } from './wa-servidor'

type Resposta =
  | { confirmacaoNecessaria: boolean; erro?: never }
  | { erro: string; confirmacaoNecessaria?: never }

async function alterar(
  executar: (usuario: string) => Promise<{ confirmacaoNecessaria: boolean }>,
): Promise<Resposta> {
  const sessao = await getRequestSession(true)
  if (!sessao) exigirLogin()
  await limitarUsuario(sessao.user.id, 'escrita')
  try {
    return await executar(sessao.user.id)
  } catch (erro) {
    if (erro instanceof ErroServidor) return { erro: erro.message }
    // Erros de SQL e do provedor podem conter parâmetros da chamada (ASVS 16.5).
    throw new Error(
      'Não foi possível alterar a configuração do servidor uazapi.',
    )
  }
}

export const salvarServidorFn = createServerFn({ method: 'POST' })
  .validator(
    (dados: { endereco: string; token: string; confirmar?: boolean }) => {
      if (
        typeof dados?.endereco !== 'string' ||
        typeof dados?.token !== 'string'
      )
        throw new Error(
          'Informe o endereço do servidor e o token de administração.',
        )
      return {
        endereco: dados.endereco,
        token: dados.token,
        confirmar: dados.confirmar === true,
      }
    },
  )
  .handler(({ data }) =>
    alterar((usuario) => salvarServidor(env, usuario, data)),
  )

export const removerServidorFn = createServerFn({ method: 'POST' })
  .validator((dados: { confirmar?: boolean }) => ({
    confirmar: dados?.confirmar === true,
  }))
  .handler(({ data }) =>
    alterar((usuario) => removerServidor(env, usuario, data)),
  )
