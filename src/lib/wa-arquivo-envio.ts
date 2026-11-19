import { detectImageType } from './avatar'

export const LIMITE_FOTO_AUDIO = 4 * 1024 * 1024
export const MAX_BYTES_ENVIO = 8 * 1024 * 1024

export class ArquivoEnvioInvalido extends Error {
  constructor(
    public readonly status: 400 | 413 | 415,
    mensagem: string,
  ) {
    super(mensagem)
  }
}

function assinatura(bytes: Uint8Array, offset: number, texto: string) {
  for (let i = 0; i < texto.length; i++)
    if (bytes[offset + i] !== texto.charCodeAt(i)) return false
  return true
}

// RFC 7845: a primeira página identifica o codec; as demais devem ser do mesmo fluxo.
function oggOpus(bytes: Uint8Array) {
  if (
    bytes.length < 47 ||
    bytes[5] !== 2 ||
    bytes[26] !== 1 ||
    bytes[27] < 19 ||
    !assinatura(bytes, 28, 'OpusHead')
  )
    return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const serial = view.getUint32(14)
  let offset = 0
  while (offset < bytes.length) {
    if (
      offset + 27 > bytes.length ||
      !assinatura(bytes, offset, 'OggS') ||
      bytes[offset + 4] !== 0 ||
      view.getUint32(offset + 14) !== serial
    )
      return false
    const tabela = offset + 27
    const dados = tabela + bytes[offset + 26]
    if (dados > bytes.length) return false
    offset = dados
    for (let i = tabela; i < dados; i++) offset += bytes[i]
  }
  return offset === bytes.length
}

// O upload pode trazer vídeo no mesmo contêiner que o gravador de voz usa.
// Caminha pelos tamanhos dos elementos e só aceita uma faixa de áudio.
const vazio = new Uint8Array(0)
function campoMp4(bytes: Uint8Array, nome: string): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let resultado: Uint8Array | undefined
  for (let i = 0, caixas = 0; i < bytes.length; caixas++) {
    if (i + 8 > bytes.length || caixas >= 4096) return vazio
    const tamanho = view.getUint32(i) || bytes.length - i
    if (tamanho < 8 || i + tamanho > bytes.length) return vazio
    if (assinatura(bytes, i + 4, nome)) {
      if (resultado) return vazio
      resultado = bytes.subarray(i + 8, i + tamanho)
    }
    i += tamanho
  }
  return resultado ?? vazio
}
function mp4Audio(bytes: Uint8Array) {
  const faixa = campoMp4(campoMp4(bytes, 'moov'), 'trak')
  const midia = campoMp4(faixa, 'mdia')
  if (!assinatura(campoMp4(midia, 'hdlr'), 8, 'soun')) return false
  const amostras = campoMp4(campoMp4(midia, 'minf'), 'stbl')
  const descricao = campoMp4(amostras, 'stsd')
  return (
    assinatura(descricao, 4, '\x00\x00\x00\x01') &&
    campoMp4(descricao.subarray(8), 'mp4a').length >= 28
  )
}

// EBML (WebM) codifica o comprimento do inteiro no primeiro bit ligado.
// Tamanhos com todos os bits de dados ligados significam "até o fim".
export function inteiroEbml(bytes: Uint8Array, pos: number, id: boolean) {
  const primeiro = bytes[pos]
  if (!primeiro) return null
  const largura = Math.clz32(primeiro) - 23
  if (pos + largura > bytes.length || (id && largura > 4)) return null
  const mascara = 0xff >>> largura
  let valor = id ? primeiro : primeiro & mascara
  let indefinido = !id && valor === mascara
  for (let i = 1; i < largura; i++) {
    valor = valor * 256 + bytes[pos + i]
    indefinido &&= bytes[pos + i] === 255
  }
  return { valor: indefinido ? Infinity : valor, largura }
}
export function campoWebm(bytes: Uint8Array, procurado: number): Uint8Array {
  let resultado: Uint8Array | undefined
  for (let i = 0, campos = 0; i < bytes.length; campos++) {
    const id = inteiroEbml(bytes, i, true)
    if (!id || campos >= 4096) return vazio
    const tamanho = inteiroEbml(bytes, i + id.largura, false)
    if (!tamanho) return vazio
    const inicio = i + id.largura + tamanho.largura
    const fim =
      tamanho.valor === Infinity ? bytes.length : inicio + tamanho.valor
    if (fim > bytes.length) return vazio
    if (id.valor === procurado) {
      if (resultado) return vazio
      resultado = bytes.subarray(inicio, fim)
    }
    i = fim
  }
  return resultado ?? vazio
}
function webmOpus(bytes: Uint8Array) {
  const cabecalho = campoWebm(bytes, 0x1a45dfa3)
  const documento = campoWebm(cabecalho, 0x4282)
  if (documento.length !== 4 || !assinatura(documento, 0, 'webm')) return false
  const segmento = campoWebm(bytes, 0x18538067)
  const faixa = campoWebm(campoWebm(segmento, 0x1654ae6b), 0xae)
  const tipo = campoWebm(faixa, 0x83)
  const codec = campoWebm(faixa, 0x86)
  return (
    tipo.length === 1 &&
    tipo[0] === 2 &&
    codec.length === 6 &&
    assinatura(codec, 0, 'A_OPUS')
  )
}

export function validarArquivoEnvio(bytes: Uint8Array) {
  if (bytes.length === 0)
    throw new ArquivoEnvioInvalido(400, 'O arquivo está vazio.')
  if (bytes.length > MAX_BYTES_ENVIO)
    throw new ArquivoEnvioInvalido(413, 'O arquivo pode ter até 8 MiB.')
  if (assinatura(bytes, 0, '%PDF-'))
    return {
      tipo: 'documento',
      mime: 'application/pdf',
      tipoUazapi: 'document',
    } as const
  const foto = detectImageType(bytes)
  if (foto) {
    if (bytes.byteLength > LIMITE_FOTO_AUDIO)
      throw new ArquivoEnvioInvalido(413, 'A foto pode ter até 4 MiB.')
    return { tipo: 'foto', mime: foto, tipoUazapi: 'image' } as const
  }
  const ogg = assinatura(bytes, 0, 'OggS')
  const webm = assinatura(bytes, 0, '\x1a\x45\xdf\xa3')
  const mp4 = assinatura(bytes, 4, 'ftyp')
  if (ogg || webm || mp4) {
    if (bytes.byteLength > LIMITE_FOTO_AUDIO)
      throw new ArquivoEnvioInvalido(413, 'O áudio pode ter até 4 MiB.')
    if (ogg && oggOpus(bytes))
      return { tipo: 'audio', mime: 'audio/ogg', tipoUazapi: 'ptt' } as const
    if (webm && webmOpus(bytes))
      return {
        tipo: 'audio',
        mime: 'audio/webm',
        tipoUazapi: 'document',
      } as const
    if (mp4 && mp4Audio(bytes))
      return {
        tipo: 'audio',
        mime: 'audio/mp4',
        tipoUazapi: 'document',
      } as const
  }
  throw new ArquivoEnvioInvalido(
    415,
    'Tipo de arquivo não aceito. Escolha uma foto JPEG, PNG ou WebP, um PDF ou um áudio gravado.',
  )
}
