import { createFileRoute } from '@tanstack/react-router'
import {
  AguardandoCarteira,
  FalhaCarteira,
} from '#/components/crm/estado-carteira'
import { TelaProtegida } from '#/components/tela-protegida'
import { quadroQuery } from '#/lib/carteira-queries'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/_app/app/funil')({
  validateSearch: (busca: Record<string, unknown>): { funil?: string } =>
    typeof busca.funil === 'string' ? { funil: busca.funil } : {},
  loaderDeps: ({ search }) => ({ funilId: search.funil }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(
      quadroQuery(context.session.user.id, deps),
    ),
  pendingComponent: AguardandoCarteira,
  errorComponent: FalhaCarteira,
  head: () => ({ meta: seo({ title: 'Funil', noindex: true }) }),
  component: () => <TelaProtegida tela="funil" />,
})
