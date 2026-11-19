import type { QueryClient } from '@tanstack/react-query'
import {
  ClientOnly,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
} from '@tanstack/react-router'
import { ThemeProvider } from 'next-themes'
import { lazy, Suspense } from 'react'
import { ErrorPage, NotFoundPage } from '#/components/error-pages'
import { appConfig } from '#/config/app'

import appCss from '../styles.css?url'

// Cartão das redes sociais (1200x630, em public/og.png). Redesenhou? Suba o
// `v`: X, WhatsApp e cia guardam a imagem pela URL por dias.
const socialCard = `${appConfig.url}/og.png?v=1`

interface MyRouterContext {
  queryClient: QueryClient
}

// REGRA: todo `lazy()` deste arquivo é renderizado dentro de <ClientOnly>,
// ou seja, só no navegador. No servidor (workerd) um `import()` pertence ao
// pedido que o disparou; se esse pedido termina antes de o módulo carregar
// (um HEAD, alguém que fecha a aba), a promessa fica presa a um pedido morto
// e, como o `lazy` é do módulo, nenhuma página responde mais até reiniciar.
// Foi o que travava o `npm run dev` (2026-11-10). `npm run test:cold` confere.

// O sonner pesa uns 30 KB e só aparece quando o visitante faz algo. Entra
// depois da hidratação, fora do caminho crítico.
const Toaster = lazy(() =>
  import('#/components/ui/sonner').then((mod) => ({ default: mod.Toaster })),
)

export const Route = createRootRouteWithContext<MyRouterContext>()({
  // Padrões de SEO do site inteiro. Cada página sobrescreve título,
  // descrição e og:* com seo() (src/lib/seo.ts); o router junta os `head`
  // sem repetir name/property, e a rota mais funda vence.
  head: ({ matches }) => {
    // Canonical = a própria URL, sem barra no fim: é a forma que a camada de
    // assets serve (`html_handling: drop-trailing-slash` no wrangler.jsonc) e
    // a que vai no sitemap. A base vem de appConfig.url (src/config/app.ts).
    const pathname = matches[matches.length - 1]?.pathname ?? '/'
    const canonical =
      appConfig.url +
      (pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname)
    return {
      meta: [
        { charSet: 'utf-8' },
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1, viewport-fit=cover',
        },
        { title: appConfig.name },
        { name: 'description', content: appConfig.description },
        { property: 'og:site_name', content: appConfig.name },
        { property: 'og:type', content: 'website' },
        { property: 'og:locale', content: 'pt_BR' },
        { property: 'og:title', content: appConfig.name },
        { property: 'og:description', content: appConfig.description },
        { property: 'og:url', content: canonical },
        { property: 'og:image', content: socialCard },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:image', content: socialCard },
      ],
      links: [
        { rel: 'stylesheet', href: appCss },
        { rel: 'icon', type: 'image/svg+xml', href: '/zapcrm.svg' },
        { rel: 'canonical', href: canonical },
      ],
    }
  },
  shellComponent: RootDocument,
  notFoundComponent: NotFoundPage,
  errorComponent: ({ error }) => <ErrorPage error={error} />,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <ClientOnly>
            <Suspense fallback={null}>
              <Toaster />
            </Suspense>
          </ClientOnly>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}
