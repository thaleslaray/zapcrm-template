import { createFileRoute } from '@tanstack/react-router'
import {
  AguardandoCarteira,
  FalhaCarteira,
} from '#/components/crm/estado-carteira'
import { TelaProtegida } from '#/components/tela-protegida'
import { agendaQuery } from '#/lib/carteira-queries'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/_app/app/retornos')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(agendaQuery(context.session.user.id)),
  pendingComponent: AguardandoCarteira,
  errorComponent: FalhaCarteira,
  head: () => ({ meta: seo({ title: 'Retornos', noindex: true }) }),
  component: () => <TelaProtegida tela="retornos" />,
})
