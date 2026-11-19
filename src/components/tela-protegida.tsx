import { useSuspenseQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { ShieldCheck } from 'lucide-react'
import { CrmTela, type TelaCrm } from '#/components/crm/tela'
import { acessoCrmQuery } from '#/lib/acesso-crm-queries'

const app = getRouteApi('/_app')
export function TelaProtegida({ tela }: { tela: TelaCrm }) {
  const { session } = app.useRouteContext()
  const { data: acesso } = useSuspenseQuery(acessoCrmQuery(session.user.id))
  const semAcesso = acesso.papel !== 'gestor' && tela === 'configuracoes'
  if (semAcesso || (acesso.papel === 'vendedor' && !acesso.setores.length)) {
    return (
      <section className="aviso-acesso">
        <ShieldCheck size={32} />
        <h1>
          {semAcesso
            ? 'Sem acesso'
            : 'Aguardando o gestor liberar um setor para você'}
        </h1>
        {semAcesso && <p>As configurações são da gestão da equipe.</p>}
      </section>
    )
  }
  return <CrmTela tela={tela} acesso={acesso} />
}
