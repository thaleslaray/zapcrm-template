import { type ErrorComponentProps, useRouter } from '@tanstack/react-router'
import { Skeleton } from '#/components/ui/skeleton'
import { Acao } from './pecas'

export function AguardandoCarteira() {
  return (
    <div className="page" role="status" aria-label="Carregando dados">
      <Skeleton className="m-4 h-9 w-40" />
      <Skeleton className="mx-4 h-12" />
      <Skeleton className="m-4 h-12" />
    </div>
  )
}

export function FalhaCarteira({ error }: ErrorComponentProps) {
  const router = useRouter()
  const mensagem = error instanceof Error ? error.message : ''
  if (
    mensagem === 'Sem acesso' ||
    mensagem === 'Aguardando o gestor liberar um setor para você'
  ) {
    return (
      <section className="aviso-acesso">
        <h1>{mensagem}</h1>
      </section>
    )
  }
  return (
    <section className="empty-list" role="alert">
      <h1>Não foi possível carregar</h1>
      <Acao onClick={() => void router.invalidate()}>Tentar de novo</Acao>
    </section>
  )
}
