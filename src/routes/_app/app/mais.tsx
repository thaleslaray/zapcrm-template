import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ChevronRight,
  Columns3,
  Layers,
  Smartphone,
  Tag,
  UserRound,
  UsersRound,
  Zap,
} from 'lucide-react'
import { Sair } from '#/components/sair'
import ThemeToggle from '#/components/ThemeToggle'
import { acessoCrmQuery } from '#/lib/acesso-crm-queries'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/_app/app/mais')({
  head: () => ({ meta: seo({ title: 'Mais', noindex: true }) }),
  component: Mais,
})
const secoes = [
  ['numeros', 'Números do WhatsApp', Smartphone],
  ['setores', 'Setores', Layers],
  ['equipe', 'Equipe', UsersRound],
  ['funis', 'Funis e etapas', Columns3],
  ['etiquetas', 'Etiquetas', Tag],
  ['respostas', 'Respostas rápidas', Zap],
] as const
function Mais() {
  const { session } = Route.useRouteContext()
  const { data: acesso } = useSuspenseQuery(acessoCrmQuery(session.user.id))
  return (
    <div className="page">
      <header className="page-head">
        <h1>Mais</h1>
      </header>
      <div className="page-body">
        <div className="mais">
          <div className="card">
            <Link to="/app/conta">
              <UserRound size={24} />
              <div>
                <strong>Minha conta</strong>
                <div className="muted">{session.user.email}</div>
              </div>
              <ChevronRight size={18} className="chev" />
            </Link>
          </div>
          {acesso.papel === 'gestor' && (
            <div className="card">
              {secoes.map(([secao, nome, Icone]) => (
                <Link key={secao} to="/app/configuracoes" search={{ secao }}>
                  <Icone size={20} />
                  {nome}
                  <ChevronRight size={18} className="chev" />
                </Link>
              ))}
            </div>
          )}
          <div className="card">
            <ThemeToggle comTexto />
            <Sair />
          </div>
        </div>
      </div>
    </div>
  )
}
