import { env } from 'cloudflare:workers'
import { createFileRoute } from '@tanstack/react-router'
import { receberEnvioMidia } from '#/lib/wa-envio-midia'

export const Route = createFileRoute('/api/whatsapp/envio/$conversaId/$id')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        receberEnvioMidia(env, request, params.conversaId, params.id),
    },
  },
})
