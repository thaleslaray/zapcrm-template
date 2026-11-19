import { timingSafeEqual } from 'node:crypto'

const utf8 = new TextEncoder()
const bytes = (base64: string) =>
  Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
const base64 = (dados: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(dados)))

async function chaveAes(segredo: string) {
  const dados = bytes(segredo)
  if (dados.byteLength !== 32)
    throw new Error('Configure a chave dos números do WhatsApp.')
  return crypto.subtle.importKey('raw', dados, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}

export async function cifrarToken(chave: string, token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cifra = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await chaveAes(chave),
    utf8.encode(token),
  )
  return `v1.${base64(iv)}.${base64(cifra)}`
}

export async function decifrarToken(chave: string, cifrado: string) {
  const [versao, iv, cifra] = cifrado.split('.')
  if (versao !== 'v1' || !iv || !cifra)
    throw new Error('Credencial do número indisponível.')
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes(iv) },
      await chaveAes(chave),
      bytes(cifra),
    ),
  )
}

export async function hashSegredo(segredo: string) {
  return base64(await crypto.subtle.digest('SHA-256', utf8.encode(segredo)))
}

// Estável por número para que a repetição de uma configuração interrompida
// restabeleça o mesmo endereço. O banco guarda apenas seu resumo.
export async function segredoDoEndereco(
  chave: string,
  numeroId: string,
  versao = '0',
) {
  const hmac = await crypto.subtle.importKey(
    'raw',
    bytes(chave),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const assinatura = await crypto.subtle.sign(
    'HMAC',
    hmac,
    utf8.encode(`zapcrm:webhook:v2:${numeroId}:${versao}`),
  )
  const assinaturaUrl = base64(assinatura)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
  return `v2.${versao}.${assinaturaUrl}`
}

export async function segredoConfere(segredo: string, resumo: string | null) {
  if (!resumo) return false
  const recebido = bytes(await hashSegredo(segredo))
  const esperado = bytes(resumo)
  return (
    recebido.length === esperado.length && timingSafeEqual(recebido, esperado)
  )
}

export async function conferirEndereco(
  chave: string,
  id: string,
  segredo: string,
) {
  const partes = /^v2\.(\d{1,16})\.([\w-]{43})$/.exec(segredo)
  if (!partes || !chave) return false
  const esperado = await segredoDoEndereco(chave, id, partes[1])
  return timingSafeEqual(utf8.encode(segredo), utf8.encode(esperado))
}

export async function autenticarAviso(
  chave: string,
  numero: { segredoWebhookHash: string | null; tokenCifrado: string | null },
  segredo: string,
  token: string,
) {
  if (!numero.tokenCifrado || !numero.segredoWebhookHash || !segredo || !token)
    return false
  if (!(await segredoConfere(segredo, numero.segredoWebhookHash))) return false
  const original = await decifrarToken(chave, numero.tokenCifrado)
  const [esperado, recebido] = await Promise.all([
    hashSegredo(original),
    hashSegredo(token),
  ])
  return timingSafeEqual(bytes(esperado), bytes(recebido))
}

export class UazapiErro extends Error {
  constructor(
    readonly status: number,
    caminho?: string,
    prazo?: string | null,
  ) {
    let mensagem = 'Não foi possível concluir a operação no WhatsApp.'
    if (status === 429) {
      if (caminho === '/instance/create')
        mensagem = 'O servidor atingiu o limite de instâncias.'
      else if (caminho === '/instance/connect')
        mensagem =
          'O servidor uazapi recusou a conexão: o limite de números conectados do plano foi atingido. Confira o plano no painel da uazapi.'
      else mensagem = 'Aguarde um momento antes de tentar de novo.'
    } else if (status === 503 && caminho === '/instance/connect') {
      mensagem = 'A conexão está temporariamente indisponível.'
    }
    if ((status === 429 || status === 503) && prazo && /^\d+$/.test(prazo)) {
      const segundos = Number(prazo)
      if (Number.isSafeInteger(segundos))
        mensagem += ` Tente novamente em ${segundos} ${segundos === 1 ? 'segundo' : 'segundos'}.`
    }
    super(mensagem)
  }
}
export class AncoraIndisponivel extends UazapiErro {}

async function requisitar(
  base: string,
  credencial: string,
  cabecalho: 'token' | 'admintoken',
  caminho: string,
  corpo?: object,
): Promise<unknown> {
  if (!base || !credencial)
    throw new Error('Configure a integração do WhatsApp.')
  let resposta: Response
  try {
    const url = new URL(caminho, base)
    if (
      url.origin !== new URL(base).origin ||
      (url.protocol !== 'https:' &&
        !(
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        ))
    )
      throw new Error()
    resposta = await fetch(url, {
      method: corpo ? 'POST' : 'GET',
      headers: { [cabecalho]: credencial, 'Content-Type': 'application/json' },
      body: corpo ? JSON.stringify(corpo) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    throw new UazapiErro(0)
  }
  if (resposta.status === 400 && caminho === '/message/history-sync') {
    const detalhe = objeto(await resposta.json().catch(() => null))
    if (
      detalhe.status === 'anchor_unavailable' ||
      detalhe.error === 'anchor_unavailable'
    )
      throw new AncoraIndisponivel(400)
  }
  if (!resposta.ok)
    throw new UazapiErro(
      resposta.status,
      caminho,
      resposta.headers.get('Retry-After'),
    )
  try {
    return await resposta.json()
  } catch {
    throw new UazapiErro(0)
  }
}

export function chamarInstancia(
  base: string,
  token: string,
  caminho: string,
  corpo?: object,
) {
  return requisitar(base, token, 'token', caminho, corpo)
}
export function chamarAdministracao(
  base: string,
  token: string,
  caminho: string,
  corpo?: object,
) {
  return requisitar(base, token, 'admintoken', caminho, corpo)
}

export type CredencialInstancia = {
  endereco: string
  token: string
  vinculo: string
}

export function objeto(dado: unknown): Record<string, unknown> {
  return dado !== null && typeof dado === 'object' && !Array.isArray(dado)
    ? (dado as Record<string, unknown>)
    : {}
}
