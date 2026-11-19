import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useLocation,
} from '@tanstack/react-router'
import {
  CalendarClock,
  Columns3,
  Ellipsis,
  MessageCircle,
  Settings,
  UsersRound,
} from 'lucide-react'
import { initials } from '#/components/account/avatar-upload'
import { Logo } from '#/components/logo'
import ThemeToggle from '#/components/ThemeToggle'
import { Avatar, AvatarFallback, AvatarImage } from '#/components/ui/avatar'
import { acessoCrmQuery } from '#/lib/acesso-crm-queries'
import { sessionQuery } from '#/lib/auth-queries'
import { seo } from '#/lib/seo'
import { useTempoReal } from '#/lib/use-tempo-real'
import { conversasQuery } from '#/lib/wa-conversas-queries'

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery)
    if (!session)
      throw redirect({ to: '/login', search: { redirect: location.href } })
    return { session }
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(
      acessoCrmQuery(context.session.user.id),
    ),
  head: () => ({ meta: seo({ title: 'ZapCRM', noindex: true }) }),
  component: AppLayout,
})

const destinos = [
  { to: '/app/conversas', nome: 'Conversas', icone: MessageCircle },
  { to: '/app/funil', nome: 'Funil', icone: Columns3 },
  { to: '/app/contatos', nome: 'Contatos', icone: UsersRound },
  { to: '/app/retornos', nome: 'Retornos', icone: CalendarClock },
] as const

function AppLayout() {
  const { session } = Route.useRouteContext()
  const { data } = useQuery(sessionQuery)
  const user = data?.user ?? session.user
  const { data: acesso } = useSuspenseQuery(acessoCrmQuery(user.id))
  useTempoReal(user.id, acesso.setores)
  const { data: fila } = useQuery({
    ...conversasQuery(user.id),
    enabled: acesso.papel === 'gestor' || acesso.setores.length > 0,
  })
  const naoLidas =
    fila?.lista.reduce((total, conversa) => total + conversa.naoLidas, 0) ?? 0
  const caminho = useLocation({ select: (location) => location.pathname })
  function links(compacto: boolean) {
    return destinos.map(({ to, nome, icone: Icone }) => {
      const quantidade =
        to === '/app/conversas'
          ? naoLidas
          : to === '/app/retornos'
            ? (fila?.atrasados ?? 0)
            : 0
      return (
        <Link
          key={to}
          to={to}
          aria-label={nome}
          title={nome}
          data-tip={nome}
          className={compacto ? '' : 'rail-btn'}
          activeProps={{ className: 'on' }}
        >
          <span className="ti">
            <Icone size={22} aria-hidden />
            {quantidade > 0 && (
              <span
                className={to === '/app/retornos' ? 'badge amber' : 'badge'}
              >
                {quantidade}
              </span>
            )}
          </span>
          {compacto && nome}
        </Link>
      )
    })
  }
  return (
    <div className="app">
      <nav className="rail" aria-label="Área logada">
        <Link className="logo" to="/app/conversas" aria-label="ZapCRM">
          <Logo className="size-9" />
        </Link>
        {links(false)}
        <div className="rail-sp" />
        {acesso.papel === 'gestor' && (
          <Link
            to="/app/configuracoes"
            className="rail-btn"
            activeProps={{ className: 'on' }}
            title="Configurações"
            aria-label="Configurações"
          >
            <Settings size={22} />
          </Link>
        )}
        <ThemeToggle />
        <Link
          className="rail-btn"
          to="/app/conta"
          activeProps={{ className: 'on' }}
          title="Minha conta"
          aria-label="Minha conta"
        >
          <Avatar>
            {user.image && <AvatarImage src={user.image} alt="" />}
            <AvatarFallback>{initials(user.name, user.email)}</AvatarFallback>
          </Avatar>
        </Link>
      </nav>
      <main className="main" id="app-main">
        <Outlet />
      </main>
      <nav className="tabs" aria-label="Destinos">
        {links(true)}
        <Link
          to="/app/mais"
          className={
            ['/app/configuracoes', '/app/conta'].includes(caminho) ? 'on' : ''
          }
          activeProps={{ className: 'on' }}
        >
          <span className="ti">
            <Ellipsis size={22} />
          </span>
          Mais
        </Link>
      </nav>
    </div>
  )
}
