import { Mic, Send, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { LIMITE_FOTO_AUDIO } from '#/lib/wa-arquivo-envio'
import { prepararGravacao } from '#/lib/wa-gravacao'
import { IconeBotao } from './pecas'

const formatos = [
  ['audio/ogg;codecs=opus', 'ogg'],
  ['audio/webm;codecs=opus', 'webm'],
  ['audio/mp4;codecs=mp4a.40.2', 'm4a'],
  ['audio/mp4', 'm4a'],
] as const

export function Gravador({
  cancelar,
  enviar,
}: {
  cancelar: () => void
  enviar: (arquivo: File, duracao: number) => void
}) {
  const gravador = useRef<MediaRecorder | null>(null)
  const [segundos, setSegundos] = useState(0)
  const [gravando, setGravando] = useState(false)
  const [erro, setErro] = useState('')
  const [comoDocumento, setComoDocumento] = useState(false)
  const [original, setOriginal] = useState<{
    arquivo: File
    duracao: number
  } | null>(null)
  const concluir = useRef<((arquivo: File, duracao: number) => void) | null>(
    null,
  )

  useEffect(() => {
    let ativo = true
    let stream: MediaStream | undefined
    let relogio: ReturnType<typeof setInterval> | undefined
    function liberar() {
      clearInterval(relogio)
      stream?.getTracks().forEach((track) => {
        track.stop()
      })
    }
    async function iniciar() {
      const formato =
        typeof MediaRecorder !== 'undefined' &&
        formatos.find(([mime]) => MediaRecorder.isTypeSupported(mime))
      if (!formato || !navigator.mediaDevices?.getUserMedia) {
        setErro(
          'Este navegador não consegue gravar áudio em um formato compatível.',
        )
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (!ativo) {
          liberar()
          return
        }
        const [mimeType, extensao] = formato
        const rec = new MediaRecorder(stream, {
          mimeType,
          audioBitsPerSecond: 64000,
        })
        gravador.current = rec
        const partes: Blob[] = []
        let bytes = 0
        const inicio = performance.now()
        const decorrido = () => (performance.now() - inicio) / 1000
        rec.ondataavailable = ({ data }) => {
          if (!ativo || !data.size || bytes > LIMITE_FOTO_AUDIO) return
          bytes += data.size
          if (bytes > LIMITE_FOTO_AUDIO) {
            partes.length = 0
            concluir.current = null
            setErro(
              'O áudio passou do limite de 4 MiB. Cancele e grave um áudio mais curto.',
            )
            if (rec.state === 'recording') rec.stop()
          } else partes.push(data)
        }
        rec.onerror = () => {
          concluir.current = null
          if (ativo)
            setErro(
              'Não foi possível concluir a gravação. Tente gravar de novo.',
            )
          liberar()
        }
        rec.onstop = async () => {
          liberar()
          if (!ativo) return
          setGravando(false)
          if (bytes > LIMITE_FOTO_AUDIO) return
          if (!partes.length) {
            setErro('Nenhum áudio foi gravado. Cancele e tente de novo.')
            return
          }
          if (!concluir.current) {
            setErro('A gravação foi interrompida. Cancele e tente de novo.')
            return
          }
          const arquivo = new File(partes, `Gravação.${extensao}`, {
            type: rec.mimeType,
          })
          const duracao = Math.max(1, Math.round(decorrido()))
          let voz: File
          try {
            voz = await prepararGravacao(arquivo)
          } catch {
            if (ativo) {
              setOriginal({ arquivo, duracao })
              setErro(
                'Não foi possível preparar a mensagem de voz. Você pode enviar a gravação original como documento.',
              )
            }
            return
          }
          if (ativo) concluir.current?.(voz, duracao)
        }
        setComoDocumento(extensao === 'm4a')
        rec.start(250)
        setGravando(true)
        relogio = setInterval(() => setSegundos(Math.floor(decorrido())), 250)
      } catch {
        liberar()
        if (ativo)
          setErro(
            'Não foi possível abrir o microfone. Confira a permissão do navegador.',
          )
      }
    }
    void iniciar()
    return () => {
      ativo = false
      const rec = gravador.current
      if (rec?.state === 'recording') rec.stop()
      liberar()
    }
  }, [])

  return (
    <div className="composer">
      <IconeBotao nome="Cancelar gravação" onClick={cancelar}>
        <Trash2 size={20} />
      </IconeBotao>
      {erro ? (
        <p className="midia-aviso" role="alert">
          {erro}
        </p>
      ) : (
        <div className="gravacao-tempo">
          <Mic size={18} />
          {gravando ? (
            <>
              Gravando{' '}
              <span role="timer" aria-label="Tempo de gravação">
                {Math.floor(segundos / 60)}:
                {String(segundos % 60).padStart(2, '0')}
              </span>
              {comoDocumento && ' · O áudio será enviado como documento.'}
            </>
          ) : concluir.current ? (
            'Concluindo gravação…'
          ) : (
            'Abrindo microfone…'
          )}
        </div>
      )}
      <button
        type="button"
        className="send"
        aria-label={original ? 'Enviar como documento' : 'Enviar áudio'}
        disabled={!original && (!gravando || !!erro)}
        onClick={() => {
          if (original) {
            enviar(original.arquivo, original.duracao)
            return
          }
          const rec = gravador.current
          if (rec?.state !== 'recording') return
          concluir.current = enviar
          setGravando(false)
          rec.stop()
        }}
      >
        <Send size={22} />
      </button>
    </div>
  )
}
