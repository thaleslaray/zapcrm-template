import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { executarComandoFn } from '#/lib/carteira-comandos'
import { invalidarCarteira } from '#/lib/carteira-queries'
import type { ComandoRetorno } from '#/lib/retornos-escrita'

export function useRetorno() {
  const cache = useQueryClient()
  const ocupado = useRef(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  async function gravar(comando: ComandoRetorno) {
    if (ocupado.current) return false
    ocupado.current = true
    setSalvando(true)
    setErro('')
    try {
      const resultado = await executarComandoFn({ data: comando })
      if (!resultado.ok) {
        setErro(resultado.mensagem)
        return false
      }
      await invalidarCarteira(cache)
      return true
    } catch {
      setErro('Não foi possível confirmar o retorno. Tente de novo.')
      return false
    } finally {
      ocupado.current = false
      setSalvando(false)
    }
  }
  return { gravar, erro, salvando }
}
