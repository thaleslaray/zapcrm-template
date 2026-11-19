import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { EmailOtpForm } from '#/components/auth/email-otp-form'
import { PasswordForm } from '#/components/auth/password-form'
import { SocialButtons } from '#/components/auth/social-buttons'
import { Logo } from '#/components/logo'
import { authFailureMessage, toAuthFailure } from '#/lib/auth-failure'
import { authProvidersQuery } from '#/lib/auth-queries'

// Mensagens para o `?error=` que volta de um login social recusado.
function describeError(code: string | undefined) {
  if (!code) return null
  // O código volta na URL, às vezes em minúsculas: conta encerrada tem texto próprio.
  const failure = toAuthFailure({ code: code.toUpperCase() })
  if (failure !== 'unknown') return authFailureMessage(failure, 'entrar')
  return 'Não foi possível entrar com esse método. Tente de novo ou use o código por e-mail.'
}

export function LoginPanel({
  callbackURL,
  error,
}: {
  callbackURL: string
  error?: string
}) {
  const message = describeError(error)
  // Senha é opcional (PASSWORD_LOGIN_ENABLED): sem ela, só o código por e-mail.
  const { data: providers } = useQuery(authProvidersQuery)
  return (
    <main className="login">
      <div className="card">
        <div className="brandline">
          <Logo className="size-9" />
          ZapCRM
        </div>
        <h1>Entrar</h1>
        <p>Atenda seus clientes do WhatsApp com a equipe toda.</p>
        {message ? (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        ) : null}

        <EmailOtpForm callbackURL={callbackURL} />
        <SocialButtons callbackURL={callbackURL} />

        {providers?.password ? (
          <details className="group text-sm">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              Prefere entrar com senha?
            </summary>
            <div className="pt-4">
              <PasswordForm callbackURL={callbackURL} />
            </div>
          </details>
        ) : null}

        <div className="foot">
          Sem senha. Você recebe um código no e-mail.
          <br />
          Ao continuar você concorda com os{' '}
          <Link
            to="/termos"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Termos de uso
          </Link>{' '}
          e a{' '}
          <Link
            to="/privacidade"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Política de privacidade
          </Link>
          .
        </div>
      </div>
    </main>
  )
}
