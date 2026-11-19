import type { CSSProperties, ReactNode } from 'react'
import { Badge } from '#/components/ui/badge'
import type { Marca } from '#/lib/carteira-leitura-tipos'

const dinheiro = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const dinheiroComCentavos = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

export function valorEmReais(centavos: number) {
  const formato = centavos % 100 === 0 ? dinheiro : dinheiroComCentavos
  return formato.format(centavos / 100)
}

const formatoData = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'America/Sao_Paulo',
})
const formatoHora = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
})
const formatoDia = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo',
})

export function dataBreve(instante: number) {
  return formatoData.format(instante)
}

export function dataRelativa(instante: number) {
  const hoje = Date.now()
  const dia = formatoDia.format(instante)
  if (dia === formatoDia.format(hoje)) return formatoHora.format(instante)
  if (dia === formatoDia.format(hoje - 86_400_000)) return 'Ontem'
  return dataBreve(instante)
}

export function corDaMarca(variavel: '--pc' | '--c', cor: string) {
  return { [variavel]: cor } as CSSProperties
}

export function EtiquetaCarteira({
  etiqueta,
  children,
}: {
  etiqueta: Marca
  children?: ReactNode
}) {
  const style = {
    '--tb': `color-mix(in srgb, ${etiqueta.cor} 16%, var(--surface))`,
    '--tf': `color-mix(in srgb, ${etiqueta.cor} 55%, var(--text))`,
  } as CSSProperties
  return (
    <Badge variant="ghost" className="tag" style={style}>
      {etiqueta.nome}
      {children}
    </Badge>
  )
}

export function enderecoDoContato(
  contato: string,
  opcoes: { conversa?: string; funil?: string; painel?: boolean } = {},
) {
  const params = new URLSearchParams({ contato })
  if (opcoes.conversa) params.set('conversa', opcoes.conversa)
  if (opcoes.funil) params.set('funil', opcoes.funil)
  if (opcoes.painel || !opcoes.conversa) params.set('painel', 'true')
  return `/app/conversas?${params}`
}
