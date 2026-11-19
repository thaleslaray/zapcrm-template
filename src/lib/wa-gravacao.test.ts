import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { validarArquivoEnvio } from './wa-arquivo-envio'
import { prepararGravacao } from './wa-gravacao'

// Gravação de 720 ms do microfone sintético do Chromium com MediaRecorder.start(250).
// O FFmpeg mediu o SHA-256 dos pacotes Opus concatenados com -c copy -f hash.
it('envia a gravação WebM do Chromium como voz preservando os pacotes e a duração', async () => {
  const amostra = await readFile('src/test/gravacao-chromium.webm')
  const arquivo = await prepararGravacao(
    new File([amostra], 'Gravação.webm', { type: 'audio/webm;codecs=opus' }),
  )
  const bytes = Buffer.from(await arquivo.arrayBuffer())
  expect(validarArquivoEnvio(bytes)).toEqual({
    tipo: 'audio',
    mime: 'audio/ogg',
    tipoUazapi: 'ptt',
  })
  expect(arquivo.type).toBe('audio/ogg')
  const audio = createHash('sha256')
  let amostras = 0n
  for (let pos = 0; pos < bytes.length; ) {
    const segmentos = bytes[pos + 26]
    const dados = pos + 27 + segmentos
    const fim =
      dados + bytes.subarray(pos + 27, dados).reduce((a, b) => a + b, 0)
    if (bytes.readUInt32LE(pos + 18) >= 2)
      audio.update(bytes.subarray(dados, fim))
    amostras = bytes.readBigUInt64LE(pos + 6)
    pos = fim
  }
  expect(audio.digest('hex')).toBe(
    '15b5b758724e319fd1bd1caec1dc8e1dcc00a7d18443160f02fe950d6db72124',
  )
  expect(amostras).toBe(34560n)
})
