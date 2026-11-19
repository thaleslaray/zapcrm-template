import { useSearch } from '@tanstack/react-router'
import type { setoresVisiveis } from '#/lib/acesso-crm'
import { Configuracoes } from './configuracoes'
import { Contatos } from './contatos'
import { Conversas } from './conversas'
import { Funil } from './funil'
import { Retornos } from './retornos'

const titulos = {
  conversas: 'Conversas',
  funil: 'Funil',
  contatos: 'Contatos',
  retornos: 'Retornos',
  configuracoes: 'Configurações',
} as const
export type TelaCrm = keyof typeof titulos
export function CrmTela({
  tela,
  acesso,
}: {
  tela: TelaCrm
  acesso: Awaited<ReturnType<typeof setoresVisiveis>>
}) {
  const search = useSearch({ strict: false }) as {
    secao?: string
    funil?: string
  }
  const gestor = acesso.papel === 'gestor'
  switch (tela) {
    case 'conversas':
      return <Conversas gestor={gestor} />
    case 'funil':
      return <Funil />
    case 'contatos':
      return <Contatos />
    case 'retornos':
      return <Retornos />
    case 'configuracoes':
      return <Configuracoes secao={search.secao} funil={search.funil} />
  }
}
