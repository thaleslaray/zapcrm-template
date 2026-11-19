import { createFileRoute } from '@tanstack/react-router'
import {
  AguardandoCarteira,
  FalhaCarteira,
} from '#/components/crm/estado-carteira'
import { TelaProtegida } from '#/components/tela-protegida'
import { acessoCrmQuery } from '#/lib/acesso-crm-queries'
import { etiquetasGestaoQuery, respostasQuery } from '#/lib/catalogos-queries'
import { equipeQuery, estruturaQuery } from '#/lib/empresa-queries'
import { seo } from '#/lib/seo'
import { painelNumerosQuery } from '#/lib/wa-numeros-queries'

export const Route = createFileRoute('/_app/app/configuracoes')({
  validateSearch: (
    busca: Record<string, unknown>,
  ): { secao?: string; funil?: string; numero?: string } => ({
    secao: typeof busca.secao === 'string' ? busca.secao : undefined,
    numero: typeof busca.numero === 'string' ? busca.numero : undefined,
    funil: typeof busca.funil === 'string' ? busca.funil : undefined,
  }),
  loaderDeps: ({ search }) => ({ secao: search.secao ?? 'numeros' }),
  loader: async ({ context, deps }) => {
    const usuario = context.session.user.id
    const acesso = await context.queryClient.ensureQueryData(
      acessoCrmQuery(usuario),
    )
    if (acesso.papel !== 'gestor') return
    if (deps.secao === 'equipe')
      await context.queryClient.ensureQueryData(equipeQuery(usuario))
    else if (deps.secao === 'setores' || deps.secao === 'funis')
      await context.queryClient.ensureQueryData(estruturaQuery(usuario))
    else if (deps.secao === 'etiquetas')
      await context.queryClient.ensureQueryData(etiquetasGestaoQuery(usuario))
    else if (deps.secao === 'respostas')
      await context.queryClient.ensureQueryData(respostasQuery(usuario))
    else await context.queryClient.ensureQueryData(painelNumerosQuery(usuario))
  },
  head: () => ({ meta: seo({ title: 'Configurações', noindex: true }) }),
  pendingComponent: AguardandoCarteira,
  errorComponent: FalhaCarteira,
  component: () => <TelaProtegida tela="configuracoes" />,
})
