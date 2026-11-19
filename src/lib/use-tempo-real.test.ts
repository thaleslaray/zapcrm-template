import { afterEach, expect, it, vi } from 'vitest'
import { useTempoReal } from './use-tempo-real'

let desmontar: () => void
vi.mock('react', () => ({
  useEffect: (montar: () => () => void) => {
    desmontar = montar()
  },
}))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('uma montagem desfeita libera o canal e a página volta a assinar ao ser restaurada', () => {
  vi.useFakeTimers()
  const aba = Object.assign(new EventTarget(), {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  })
  vi.stubGlobal('window', aba)
  vi.stubGlobal('location', { origin: 'https://exemplo.test' })
  const abertas: Canal[] = []
  class Canal {
    static OPEN = 1
    readyState = 0
    onopen?: () => void
    close = vi.fn()
    constructor() {
      abertas.push(this)
    }
  }
  vi.stubGlobal('WebSocket', Canal)
  useTempoReal('ana', ['com'])
  desmontar()
  vi.advanceTimersByTime(50)
  expect(abertas).toHaveLength(0)
  useTempoReal('ana', ['com'])
  vi.advanceTimersByTime(50)
  expect(abertas).toHaveLength(1)
  desmontar()
  expect(abertas[0].close).not.toHaveBeenCalled()
  abertas[0].readyState = Canal.OPEN
  abertas[0].onopen?.()
  expect(abertas[0].close).toHaveBeenCalledOnce()

  useTempoReal('ana', ['com'])
  vi.advanceTimersByTime(1)
  abertas[1].readyState = Canal.OPEN
  aba.dispatchEvent(new Event('pagehide'))
  expect(abertas[1].close).toHaveBeenCalledOnce()
  aba.dispatchEvent(new Event('pageshow'))
  vi.advanceTimersByTime(1)
  expect(abertas).toHaveLength(3)
  desmontar()
})
