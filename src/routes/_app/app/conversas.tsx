import { createFileRoute } from '@tanstack/react-router'
import {
  AguardandoCarteira,
  FalhaCarteira,
} from '#/components/crm/estado-carteira'
import { TelaProtegida } from '#/components/tela-protegida'
import { painelQuery } from '#/lib/carteira-queries'
import { seo } from '#/lib/seo'
import { conversasQuery } from '#/lib/wa-conversas-queries'

type Busca = {
  conversa?: string
  contato?: string
  funil?: string
  painel?: boolean
}
export const Route = createFileRoute('/_app/app/conversas')({
  validateSearch: (busca: Record<string, unknown>): Busca => ({
    conversa: typeof busca.conversa === 'string' ? busca.conversa : undefined,
    contato: typeof busca.contato === 'string' ? busca.contato : undefined,
    funil: typeof busca.funil === 'string' ? busca.funil : undefined,
    painel:
      busca.painel === undefined ? undefined : String(busca.painel) === 'true',
  }),
  loaderDeps: ({ search: { contato, conversa, funil } }) => ({
    contatoId: contato,
    conversaId: conversa,
    funilId: funil,
  }),
  loader: async ({ context: { queryClient, session }, deps: alvo }) => {
    const usuario = session.user.id
    await Promise.all([
      queryClient.ensureQueryData(conversasQuery(usuario)),
      (alvo.contatoId || alvo.conversaId) &&
        queryClient.ensureQueryData(painelQuery(usuario, alvo)),
    ])
  },
  pendingComponent: AguardandoCarteira,
  errorComponent: FalhaCarteira,
  head: () => ({ meta: seo({ title: 'Conversas', noindex: true }) }),
  component: () => <TelaProtegida tela="conversas" />,
})
