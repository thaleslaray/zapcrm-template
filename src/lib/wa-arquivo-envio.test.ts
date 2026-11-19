import { expect, it } from 'vitest'
import { validarArquivoEnvio } from './wa-arquivo-envio'

it('identifica uma foto PNG pelo conteúdo', () => {
  expect(
    validarArquivoEnvio(Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)),
  ).toEqual({
    tipo: 'foto',
    mime: 'image/png',
    tipoUazapi: 'image',
  })
})

it('recusa foto acima de 4 MiB com o limite no erro', () => {
  const foto = new Uint8Array(4 * 1024 * 1024 + 1)
  foto.set([0xff, 0xd8, 0xff])
  expect(() => validarArquivoEnvio(foto)).toThrow(/4 MiB/)
})

it('permite PDF de até 8 MiB e informa quando excede', () => {
  const pdf = new Uint8Array(8 * 1024 * 1024 + 1)
  pdf.set(new TextEncoder().encode('%PDF-1.7'))
  expect(validarArquivoEnvio(pdf.subarray(0, -1))).toEqual({
    tipo: 'documento',
    mime: 'application/pdf',
    tipoUazapi: 'document',
  })
  expect(() => validarArquivoEnvio(pdf)).toThrow(/8 MiB/)
})

it('recusa arquivo vazio e tipo desconhecido', () => {
  expect(() => validarArquivoEnvio(new Uint8Array())).toThrow(/vazio/)
  expect(() => validarArquivoEnvio(new TextEncoder().encode('<html>'))).toThrow(
    /tipo|formato/i,
  )
})

// Primeira página do Ogg/Opus de um canal, gerado pelo FFmpeg.
const ogg = Buffer.from(
  '4f67675300020000000000000000a25e45ba00000000366e520301134f707573486561640101380180bb0000000000',
  'hex',
)
it('envia Ogg com Opus como mensagem de voz e recusa outro fluxo multiplexado', () => {
  expect(validarArquivoEnvio(ogg)).toEqual({
    tipo: 'audio',
    mime: 'audio/ogg',
    tipoUazapi: 'ptt',
  })
  const outraPagina = Buffer.from(ogg)
  outraPagina[14] ^= 0xff
  expect(() => validarArquivoEnvio(Buffer.concat([ogg, outraPagina]))).toThrow(
    /tipo/i,
  )
})

// Metadados WebM com Segment de tamanho desconhecido, como o MediaRecorder.
const cabecalhoWebm = '1a45dfa3874282847765626d18538067ff'
const faixaOpus = 'ae8b8381028686415f4f505553'
const faixaVideo = 'ae8a8381018685565f565038'
it('aceita a gravação WebM original como documento e recusa a que contém vídeo', () => {
  const audio = Buffer.from(`${cabecalhoWebm}1654ae6b8d${faixaOpus}`, 'hex')
  expect(validarArquivoEnvio(audio)).toEqual({
    tipo: 'audio',
    mime: 'audio/webm',
    tipoUazapi: 'document',
  })
  const video = Buffer.from(
    `${cabecalhoWebm}1654ae6b99${faixaOpus}${faixaVideo}`,
    'hex',
  )
  expect(() => validarArquivoEnvio(video)).toThrow(/tipo/i)
})

function caixaMp4(tipo: string, conteudo: Buffer) {
  const cabecalho = Buffer.alloc(8)
  cabecalho.writeUInt32BE(conteudo.length + 8)
  cabecalho.write(tipo, 4)
  return Buffer.concat([cabecalho, conteudo])
}
it('envia MP4 com faixa de som como arquivo e recusa o que também tem imagem', () => {
  const ftyp = caixaMp4('ftyp', Buffer.from('isom0000isom'))
  function faixa(handler: string, codec: string) {
    const hdlr = caixaMp4(
      'hdlr',
      Buffer.concat([Buffer.alloc(8), Buffer.from(handler)]),
    )
    const stsd = caixaMp4(
      'stsd',
      Buffer.concat([
        Buffer.from('0000000000000001', 'hex'),
        caixaMp4(codec, Buffer.alloc(28)),
      ]),
    )
    return caixaMp4(
      'trak',
      caixaMp4(
        'mdia',
        Buffer.concat([hdlr, caixaMp4('minf', caixaMp4('stbl', stsd))]),
      ),
    )
  }
  const audio = faixa('soun', 'mp4a')
  expect(
    validarArquivoEnvio(Buffer.concat([ftyp, caixaMp4('moov', audio)])),
  ).toEqual({ tipo: 'audio', mime: 'audio/mp4', tipoUazapi: 'document' })
  const video = Buffer.concat([audio, faixa('vide', 'avc1')])
  expect(() =>
    validarArquivoEnvio(Buffer.concat([ftyp, caixaMp4('moov', video)])),
  ).toThrow(/tipo/i)
})
