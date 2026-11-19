import { createFileRoute } from '@tanstack/react-router'
import {
  AguardandoCarteira,
  FalhaCarteira,
} from '#/components/crm/estado-carteira'
import { TelaProtegida } from '#/components/tela-protegida'
import { contatosQuery } from '#/lib/carteira-queries'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/_app/app/contatos')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(contatosQuery(context.session.user.id)),
  pendingComponent: AguardandoCarteira,
  errorComponent: FalhaCarteira,
  head: () => ({ meta: seo({ title: 'Contatos', noindex: true }) }),
  component: () => <TelaProtegida tela="contatos" />,
})
