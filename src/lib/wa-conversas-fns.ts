import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { getDb } from '#/db'
import { limitarUsuario, type UserLimitScope } from '#/lib/rate-limit'
import { getRequestSession } from '#/lib/request-session'
import {
  lerConversaComHistorico,
  listarConversas,
  marcarLida,
} from '#/lib/wa-conversas'
import { enviarTexto, type PedidoTexto } from '#/lib/wa-conversas-envio'
import { exigirLogin } from './exigir-login'
import { pedirHistorico } from './wa-historico-manual'

async function comAcesso<T>(
  escopo: UserLimitScope,
  operacao: (usuario: string) => Promise<T>,
) {
  const sessao = await getRequestSession(escopo === 'escrita')
  if (!sessao) exigirLogin()
  await limitarUsuario(sessao.user.id, escopo)
  try {
    return await operacao(sessao.user.id)
  } catch (e) {
    if (e instanceof Error && e.message === 'Sem acesso a esta conversa.')
      throw e
    // Erros do banco podem incluir o SQL e o texto da mensagem.
    throw new Error('Não foi possível concluir a operação na conversa.')
  }
}
function validarId(valor: unknown) {
  if (typeof valor !== 'string' || !valor.trim() || valor.length > 180)
    throw new Error('Conversa inválida.')
  return valor
}
function validarEnvio(valor: unknown): PedidoTexto {
  if (
    typeof valor !== 'object' ||
    !valor ||
    !('id' in valor) ||
    typeof valor.id !== 'string' ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(valor.id) ||
    !('texto' in valor) ||
    typeof valor.texto !== 'string' ||
    !valor.texto.trim() ||
    valor.texto.length > 16000 ||
    !('conversaId' in valor)
  )
    throw new Error('Informe uma mensagem válida de até 16.000 caracteres.')
  return {
    id: valor.id,
    texto: valor.texto.trim(),
    conversaId: validarId(valor.conversaId),
    repetir: 'repetir' in valor && valor.repetir === true,
  }
}

export const filaConversasFn = createServerFn({ method: 'GET' }).handler(() =>
  comAcesso('leitura', (usuario) => listarConversas(getDb(env.DB), usuario)),
)
export const lerChatFn = createServerFn({ method: 'GET' })
  .validator(validarId)
  .handler(({ data }) =>
    comAcesso('leitura', (usuario) =>
      lerConversaComHistorico(getDb(env.DB), usuario, data),
    ),
  )
export const marcarLidaFn = createServerFn({ method: 'POST' })
  .validator(validarId)
  .handler(({ data }) =>
    comAcesso('escrita', (usuario) => marcarLida(getDb(env.DB), usuario, data)),
  )
export const enviarTextoFn = createServerFn({ method: 'POST' })
  .validator(validarEnvio)
  .handler(({ data }) =>
    comAcesso('escrita', (usuario) =>
      enviarTexto(getDb(env.DB), env, usuario, data),
    ),
  )

export const carregarAnterioresFn = createServerFn({ method: 'POST' })
  .validator(validarId)
  .handler(({ data }) =>
    comAcesso('escrita', (usuario) =>
      pedirHistorico(getDb(env.DB), env, usuario, data),
    ),
  )
