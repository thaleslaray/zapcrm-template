import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

// Cada aba mantém uma assinatura por setor visível durante a sessão da equipe.
function assinarSetor(
  setor: string,
  estado: (conectado: boolean) => void,
  mudou: () => void,
) {
  const url = new URL(
    `/api/tempo-real/${encodeURIComponent(setor)}`,
    location.origin,
  )
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  let socket: WebSocket | undefined
  let espera = 1000
  let tentativa: number | undefined
  let ativo = true

  function reagendar() {
    if (!ativo) return
    estado(false)
    tentativa = window.setTimeout(conectar, espera)
    espera = Math.min(30_000, espera * 2)
  }
  function conectar() {
    let canal: WebSocket
    try {
      canal = new WebSocket(url.href)
      socket = canal
    } catch {
      reagendar()
      return
    }
    canal.onopen = () => {
      if (!ativo || canal !== socket) {
        canal.close(1000)
        return
      }
      espera = 1000
      estado(true)
      mudou() // Recupera também o que chegou entre a leitura inicial e a conexão.
    }
    canal.onmessage = (evento) => {
      if (ativo && canal === socket && evento.data === 'mudou') mudou()
    }
    canal.onclose = () => {
      if (canal === socket) reagendar()
    }
  }
  function suspender() {
    ativo = false
    window.clearTimeout(tentativa)
    const anterior = socket
    socket = undefined
    // Se o upgrade já saiu, deixe o handshake concluir: onopen fecha a ponta
    // aceita no servidor mesmo que o componente já tenha sido desmontado.
    if (anterior?.readyState === WebSocket.OPEN) anterior.close(1000)
  }
  function retomar() {
    if (ativo) return
    ativo = true
    estado(false)
    espera = 1000
    tentativa = window.setTimeout(conectar, 0)
  }
  // O React pode montar e desmontar um efeito na mesma tarefa. Só reserve
  // uma conexão para a montagem que efetivamente continuar na página.
  tentativa = window.setTimeout(conectar, 0)
  window.addEventListener('pagehide', suspender)
  window.addEventListener('pageshow', retomar)
  return () => {
    window.removeEventListener('pagehide', suspender)
    window.removeEventListener('pageshow', retomar)
    suspender()
  }
}

const leituras = ['wa-conversas', 'wa-chat', 'wa-numeros']

export function useTempoReal(usuario: string, setores: string[]) {
  const cache = useQueryClient()
  useEffect(() => {
    if (!setores.length) return
    let ativo = true
    let intervalo: number | undefined
    let atualizacao: number | undefined
    const abertos = new Set<string>()

    function atualizar() {
      // Um lote (ou dois setores abrindo juntos) pede a mesma releitura.
      if (atualizacao !== undefined) return
      atualizacao = window.setTimeout(async () => {
        atualizacao = undefined
        const filtro = {
          predicate: ({ queryKey }: { queryKey: readonly unknown[] }) =>
            queryKey[1] === usuario && leituras.includes(String(queryKey[0])),
        }
        // Uma primeira leitura ainda sem dados seria reaproveitada pelo Query.
        // Aguarde-a antes de buscar a versão posterior ao aviso.
        const primeiras = cache
          .getQueryCache()
          .findAll(filtro)
          .filter(
            (q) =>
              q.state.data === undefined && q.state.fetchStatus === 'fetching',
          )
        await Promise.allSettled(primeiras.map((q) => q.promise))
        if (ativo) await cache.invalidateQueries(filtro)
      }, 25)
    }
    function ajustarIntervalo() {
      if (abertos.size === setores.length) {
        window.clearInterval(intervalo)
        intervalo = undefined
      } else if (intervalo === undefined) {
        intervalo = window.setInterval(() => {
          if (document.hidden) return
          atualizar()
          // Durante o pareamento, a consulta de contingência verifica a uazapi.
          void cache.refetchQueries({
            queryKey: ['wa-pareamento', usuario],
            type: 'active',
          })
        }, 4000)
      }
    }

    ajustarIntervalo()
    const fechar = setores.map((setor) =>
      assinarSetor(
        setor,
        (conectado) => {
          if (conectado) abertos.add(setor)
          else abertos.delete(setor)
          ajustarIntervalo()
        },
        atualizar,
      ),
    )
    return () => {
      ativo = false
      window.clearTimeout(atualizacao)
      window.clearInterval(intervalo)
      for (const encerrar of fechar) encerrar()
    }
  }, [usuario, setores, cache])
}
