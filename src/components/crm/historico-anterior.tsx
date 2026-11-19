import { useMutation } from '@tanstack/react-query'
import { History } from 'lucide-react'
import type { lerConversaComHistorico } from '#/lib/wa-conversas'
import { carregarAnterioresFn } from '#/lib/wa-conversas-fns'
import { Acao } from './pecas'

type Historico = Awaited<
  ReturnType<typeof lerConversaComHistorico>
>['historico']

function mensagem(historico: Historico) {
  switch (historico.estado) {
    case 'disponivel':
      return null
    case 'pendente':
      return 'Pedido enviado. As mensagens aparecerão aqui quando o celular responder.'
    case 'incerto':
      return 'Aguardando confirmação do pedido pelo WhatsApp.'
    case 'inicio':
      return 'Você chegou ao início da conversa.'
    case 'mais':
      return 'Há mais mensagens anteriores no celular.'
    case 'inacessivel':
      return 'O WhatsApp informou que o restante da conversa não está acessível.'
    case 'expirado':
      return 'O pedido expirou. Abra o WhatsApp no celular e tente novamente.'
    case 'inconclusivo':
      return 'O WhatsApp não confirmou o início da conversa nem indicou outro lote.'
    case 'falha':
      return 'Não foi possível solicitar as mensagens anteriores. Tente novamente.'
    case 'bloqueado':
      switch (historico.motivo) {
        case 'pagination_no_progress':
          return 'O celular repetiu a mesma página ou não entregou mensagens mais antigas.'
        case 'anchor_unavailable':
          return 'A mensagem de referência não está mais disponível no celular.'
        case 'history_access_unavailable':
          return 'O restante do histórico não está acessível no celular.'
        case 'cursor_lookup_failed':
          return 'O WhatsApp não conseguiu identificar a próxima mensagem de referência.'
        default:
          return 'O WhatsApp bloqueou a recuperação das mensagens anteriores.'
      }
  }
}

export function HistoricoAnterior({
  historico,
  conversaId,
  atualizar,
}: {
  historico: Historico
  conversaId: string
  atualizar: () => Promise<unknown>
}) {
  const pedido = useMutation({
    mutationFn: () => carregarAnterioresFn({ data: conversaId }),
    onSettled: () => atualizar(),
    retry: false,
  })
  const podePedir = ['disponivel', 'mais', 'expirado', 'falha'].includes(
    historico.estado,
  )
  const texto = mensagem(historico)
  return (
    <div className="historico-anterior">
      {texto && <p role="status">{texto}</p>}
      {pedido.isError && (
        <p role="alert">
          Não foi possível solicitar o histórico. Verifique a conexão do número.
        </p>
      )}
      {podePedir && (
        <Acao
          className="btn-sm"
          disabled={pedido.isPending}
          onClick={() => pedido.mutate()}
        >
          <History size={15} />
          {pedido.isPending
            ? 'Solicitando mensagens…'
            : 'Carregar mensagens anteriores'}
        </Acao>
      )}
    </div>
  )
}
