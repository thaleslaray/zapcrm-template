import { campoWebm, inteiroEbml, LIMITE_FOTO_AUDIO } from './wa-arquivo-envio'

function invalido(): never {
  throw new Error('Formato de gravação WebM não reconhecido.')
}

function numero(bytes: Uint8Array) {
  return bytes.reduce((valor, byte) => valor * 256 + byte, 0)
}

// RFC 6716, seção 3.1. O relógio do Ogg/Opus conta amostras a 48 kHz,
// inclusive quando o microfone usa outra frequência.
function amostrasOpus(pacote: Uint8Array) {
  if (!pacote.length) return invalido()
  const toc = pacote[0]
  const config = toc >> 3
  let porQuadro: number
  if (config >= 16) porQuadro = 120 << (config & 3)
  else if (config >= 12) porQuadro = 480 << (config & 1)
  else porQuadro = [480, 960, 1920, 2880][config & 3]
  const quadros = [1, 2, 2, pacote[1] & 63][toc & 3]
  const amostras = porQuadro * quadros
  if (!amostras || amostras > 5760) return invalido()
  return amostras
}

// O MediaRecorder divide o segmento em clusters, inclusive de tamanho
// indefinido. O próximo Cluster delimita o anterior nesse caso.
function* blocos(segmento: Uint8Array) {
  let fimCluster = 0
  let aberto = false
  for (let pos = 0; pos < segmento.length; ) {
    const id = inteiroEbml(segmento, pos, true)
    if (!id) return invalido()
    const tamanho = inteiroEbml(segmento, pos + id.largura, false)
    if (!tamanho) return invalido()
    const inicio = pos + id.largura + tamanho.largura
    if (id.valor === 0x1f43b675) {
      if (!aberto && pos < fimCluster) return invalido()
      aberto = tamanho.valor === Infinity
      fimCluster = aberto ? segmento.length : inicio + tamanho.valor
      if (fimCluster > segmento.length) return invalido()
      pos = inicio
      continue
    }
    const fim = inicio + tamanho.valor
    if (fim > (pos < fimCluster ? fimCluster : segmento.length))
      return invalido()
    if (pos < fimCluster) {
      if (id.valor === 0xa3)
        yield { bloco: segmento.subarray(inicio, fim), corte: 0 }
      if (id.valor === 0xa0) {
        const grupo = segmento.subarray(inicio, fim)
        const padding = campoWebm(grupo, 0x75a2)
        if (padding[0] & 128) return invalido()
        yield {
          bloco: campoWebm(grupo, 0xa1),
          corte: Math.round((numero(padding) * 48000) / 1e9),
        }
      }
    }
    pos = fim
  }
}

function paginaOgg(
  pacotes: Uint8Array[],
  serial: number,
  indice: number,
  posicao: number,
  flags: number,
) {
  const tabela: number[] = []
  let carga = 0
  for (const pacote of pacotes) {
    carga += pacote.length
    for (let i = 255; i <= pacote.length; i += 255) tabela.push(255)
    tabela.push(pacote.length % 255)
  }
  if (tabela.length > 255) return invalido()
  const pagina = new Uint8Array(27 + tabela.length + carga)
  const view = new DataView(pagina.buffer)
  pagina.set([0x4f, 0x67, 0x67, 0x53, 0, flags]) // OggS
  view.setBigUint64(6, BigInt(posicao), true)
  view.setUint32(14, serial, true)
  view.setUint32(18, indice, true)
  pagina[26] = tabela.length
  pagina.set(tabela, 27)
  let pos = 27 + tabela.length
  for (const pacote of pacotes) {
    pagina.set(pacote, pos)
    pos += pacote.length
  }
  // CRC do Ogg (RFC 3533), calculado com o campo do próprio CRC zerado.
  let crc = 0
  for (const byte of pagina) {
    crc ^= byte << 24
    for (let bit = 0; bit < 8; bit++)
      crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1
  }
  view.setUint32(22, crc, true)
  return pagina
}

export async function prepararGravacao(arquivo: File): Promise<File> {
  if (arquivo.type.split(';')[0] !== 'audio/webm') return arquivo
  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  const segmento = campoWebm(bytes, 0x18538067)
  const faixa = campoWebm(campoWebm(segmento, 0x1654ae6b), 0xae)
  const decoder = new TextDecoder()
  const head = campoWebm(faixa, 0x63a2)
  const trilha = numero(campoWebm(faixa, 0xd7))
  if (
    !trilha ||
    numero(campoWebm(faixa, 0x83)) !== 2 ||
    decoder.decode(campoWebm(faixa, 0x86)) !== 'A_OPUS' ||
    head.length !== 19 ||
    decoder.decode(head.subarray(0, 8)) !== 'OpusHead' ||
    head[8] !== 1 ||
    (head[9] !== 1 && head[9] !== 2) ||
    head[18] !== 0
  )
    return invalido()
  const tags = new Uint8Array(16)
  tags.set(new TextEncoder().encode('OpusTags'))
  const serial = crypto.getRandomValues(new Uint32Array(1))[0]
  const paginas = [
    paginaOgg([head], serial, 0, 0, 2),
    paginaOgg([tags], serial, 1, 0, 0),
  ]
  let pacotes: Uint8Array[] = []
  let segmentos = 0
  let posicao = 0
  let inicioPagina = 0
  let descartarFim = 0
  for (const { bloco, corte } of blocos(segmento)) {
    const id = inteiroEbml(bloco, 0, false)
    if (
      !id ||
      id.valor !== trilha ||
      id.largura + 3 >= bloco.length ||
      descartarFim
    )
      return invalido()
    // Blocos com lacing contêm vários pacotes e não podem ser copiados como um só.
    if (bloco[id.largura + 2] & 6) return invalido()
    const pacote = bloco.subarray(id.largura + 3)
    const novosSegmentos = Math.floor(pacote.length / 255) + 1
    if (posicao - inicioPagina >= 48000 || segmentos + novosSegmentos > 255) {
      paginas.push(paginaOgg(pacotes, serial, paginas.length, posicao, 0))
      pacotes = []
      segmentos = 0
      inicioPagina = posicao
    }
    const amostras = amostrasOpus(pacote)
    if (corte > amostras || novosSegmentos > 255) return invalido()
    pacotes.push(pacote)
    segmentos += novosSegmentos
    posicao += amostras
    descartarFim = corte
  }
  if (!pacotes.length) return invalido()
  paginas.push(
    paginaOgg(pacotes, serial, paginas.length, posicao - descartarFim, 4),
  )
  const voz = new File(paginas, 'Gravação.ogg', { type: 'audio/ogg' })
  if (voz.size > LIMITE_FOTO_AUDIO)
    throw new Error('A mensagem de voz passou de 4 MiB.')
  return voz
}
