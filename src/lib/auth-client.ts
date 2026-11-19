import { emailOTPClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

import { verificarRespostaDaSessao } from './sessao-expirada'

export const authClient = createAuthClient({
  plugins: [emailOTPClient()],
  fetchOptions: {
    onResponse: ({ response }) => {
      verificarRespostaDaSessao(response)
    },
  },
})
