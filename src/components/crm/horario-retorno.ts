import { useEffect, useState } from 'react'

const fuso = 'America/Sao_Paulo'
const dia = new Intl.DateTimeFormat('sv-SE', { timeZone: fuso })
const hora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: fuso,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
export const diaLocal = (ms: number) => dia.format(ms)
export const horaLocal = (ms: number) => hora.format(ms)

/** O relógio do formulário é o da agenda, inclusive em um aparelho em outro fuso. */
export function instanteLocal(data: string, horario: string) {
  const alvo = Date.parse(`${data}T${horario}:00Z`)
  if (!Number.isFinite(alvo)) return NaN
  const observado = Date.parse(`${diaLocal(alvo)}T${horaLocal(alvo)}:00Z`)
  const resultado = alvo + (alvo - observado)
  return diaLocal(resultado) === data && horaLocal(resultado) === horario
    ? resultado
    : NaN
}

export function emDias(ms: number, dias: number, horario: string) {
  const calendario = new Date(`${diaLocal(ms)}T12:00:00Z`)
  calendario.setUTCDate(calendario.getUTCDate() + dias)
  return instanteLocal(calendario.toISOString().slice(0, 10), horario)
}

export function useRelogioRetornos(instantes: number[]) {
  const [agora, setAgora] = useState(Date.now)
  const proximo = instantes.reduce(
    (menor, t) => (t >= agora ? Math.min(t + 1, menor) : menor),
    emDias(agora, 1, '00:00'),
  )
  useEffect(() => {
    const atualizar = () => setAgora(Date.now())
    const timer = window.setTimeout(
      atualizar,
      Math.max(1, proximo - Date.now()),
    )
    document.addEventListener('visibilitychange', atualizar)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', atualizar)
    }
  }, [proximo])
  return agora
}
