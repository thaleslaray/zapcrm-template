import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { exigirLogin } from './exigir-login'
import { limitarUsuario } from './rate-limit'
import { getRequestSession } from './request-session'
import { objeto, UazapiErro } from './uazapi'
import { catalogoDoGestor, painelDoGestor } from './wa-numeros'
import {
  adicionarNumeros,
  conectarNumero,
  consultarPareamento,
  criarNumero,
  desconectarNumero,
  sincronizarConversas,
} from './wa-numeros-gestao'

async function usuario(modo: 'leitura' | 'escrita') {
  const sessao = await getRequestSession(modo === 'escrita')
  if (!sessao) exigirLogin()
  await limitarUsuario(sessao.user.id, modo)
  return sessao.user.id
}

function origemDosAvisos() {
  if (env.BETTER_AUTH_URL) return new URL(env.BETTER_AUTH_URL).origin
  const url = new URL(getRequest().url)
  if (
    import.meta.env.DEV &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  )
    return url.origin
  throw new Error('Configure o endereço público do ZapCRM.')
}

function texto(valor: unknown) {
  if (typeof valor !== 'string' || !valor.trim() || valor.length > 200)
    throw new Error('Confira os dados do número.')
  return valor.trim()
}
function dias(valor: unknown) {
  if (
    typeof valor !== 'number' ||
    !Number.isInteger(valor) ||
    valor < 1 ||
    valor > 365
  )
    throw new Error('Informe de 1 a 365 dias.')
  return valor
}

async function operacao<T>(executar: () => Promise<T>) {
  try {
    return await executar()
  } catch (e) {
    // Drizzle inclui os parâmetros no erro. Nenhum erro de SQL ou de rede
    // cru pode chegar ao middleware de log ou ao navegador.
    if (
      e instanceof Error &&
      /^(Servidor uazapi não configurado|O vínculo do número mudou|Sem acesso|Entre para|Configure |Confira |Informe |Escolha |A criação ainda|Aguarde |Muitas requisições|Conclua a adição|Conecte o número)/.test(
        e.message,
      )
    )
      throw new Error(e.message)
    throw new Error(
      'Não foi possível concluir a operação no WhatsApp. Tente de novo.',
    )
  }
}

function iniciarPareamento<T>(executar: () => Promise<T>) {
  return operacao(async () => {
    try {
      return { ok: true as const, valor: await executar() }
    } catch (erro) {
      // Só mensagens montadas pelo adaptador entram na resposta da operação.
      if (
        erro instanceof UazapiErro &&
        (erro.status === 429 || erro.status === 503)
      )
        return { ok: false as const, mensagem: erro.message }
      throw erro
    }
  })
}

export const painelNumerosFn = createServerFn({ method: 'GET' }).handler(() =>
  operacao(async () => painelDoGestor(env, await usuario('leitura'))),
)
export const catalogoNumerosFn = createServerFn({ method: 'GET' }).handler(() =>
  operacao(async () => catalogoDoGestor(env, await usuario('leitura'))),
)
export const adicionarNumerosFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    if (!Array.isArray(d) || d.length !== 1)
      throw new Error('Escolha os números para adicionar.')
    return d.map((item) => {
      const i = objeto(item)
      return {
        instanciaId: texto(i.instanciaId),
        setorId: texto(i.setorId),
        funilId: texto(i.funilId),
      }
    })
  })
  .handler(({ data }) =>
    operacao(async () =>
      adicionarNumeros(env, await usuario('escrita'), origemDosAvisos(), data),
    ),
  )
export const criarNumeroFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const i = objeto(d)
    return {
      id: texto(i.id),
      nome: texto(i.nome),
      dias: dias(i.dias),
      setorId: texto(i.setorId),
      funilId: texto(i.funilId),
    }
  })
  .handler(({ data }) =>
    iniciarPareamento(async () =>
      criarNumero(env, await usuario('escrita'), origemDosAvisos(), data),
    ),
  )
export const conectarNumeroFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const i = objeto(d)
    return {
      id: texto(i.id),
      dias: dias(i.dias),
      instanciaId:
        i.instanciaId === undefined ? undefined : texto(i.instanciaId),
      telefone: i.telefone === undefined ? undefined : texto(i.telefone),
    }
  })
  .handler(({ data }) =>
    iniciarPareamento(async () =>
      conectarNumero(env, await usuario('escrita'), data, origemDosAvisos()),
    ),
  )
export const consultarPareamentoFn = createServerFn({ method: 'POST' })
  .validator(texto)
  .handler(({ data }) =>
    operacao(async () =>
      consultarPareamento(env, await usuario('escrita'), data),
    ),
  )
export const desconectarNumeroFn = createServerFn({ method: 'POST' })
  .validator(texto)
  .handler(({ data }) =>
    operacao(async () =>
      desconectarNumero(env, await usuario('escrita'), data),
    ),
  )

export const sincronizarConversasFn = createServerFn({ method: 'POST' })
  .validator(texto)
  .handler(({ data }) =>
    operacao(async () =>
      sincronizarConversas(env, await usuario('escrita'), data),
    ),
  )
