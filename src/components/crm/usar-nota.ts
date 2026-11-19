import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { executarComandoFn } from '#/lib/carteira-comandos'
import type { ComandoNota } from '#/lib/notas'

const app = getRouteApi('/_app')

export function useGravarNota(contatoId: string, conversaId?: string) {
  const cache = useQueryClient()
  const usuario = app.useRouteContext().session.user.id
  const pedido = useRef('')
  const emVoo = useRef(false)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')

  async function gravar(comando: ComandoNota) {
    if (emVoo.current) return false
    emVoo.current = true
    setOcupado(true)
    setErro('')
    try {
      const resposta = await executarComandoFn({ data: comando })
      if (!resposta.ok) {
        setErro(resposta.mensagem)
        return false
      }
      await cache.invalidateQueries({
        queryKey: conversaId
          ? ['wa-chat', usuario, conversaId]
          : ['carteira', usuario, 'painel'],
      })
      return true
    } catch {
      setErro('Não foi possível confirmar a nota. Tente de novo.')
      return false
    } finally {
      emVoo.current = false
      setOcupado(false)
    }
  }

  async function criar(texto: string) {
    if (!pedido.current) pedido.current = crypto.randomUUID()
    const id = pedido.current
    const ok = await gravar(
      conversaId
        ? { tipo: 'criarNotaInterna', id, texto, contatoId, conversaId }
        : { tipo: 'criarNota', id, texto, contatoId },
    )
    if (ok) pedido.current = ''
    return ok
  }
  return { criar, gravar, ocupado, erro, limparErro: () => setErro('') }
}
