import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { bancoE2E } from './helpers'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Garante as tabelas no D1 local antes de subir o servidor.
export default function globalSetup() {
  const result = spawnSync(
    'npm',
    ['run', 'db:migrate:local', '--', '--persist-to', bancoE2E],
    {
      cwd: root,
      stdio: 'inherit',
    },
  )
  if (result.status !== 0) {
    throw new Error(
      'Falha ao aplicar as migrations no D1 local (npm run db:migrate:local).',
    )
  }
  return () => {
    // Só remove o banco de teste descartável criado para esta execução.
    if (/^\.wrangler\/e2e-state\/[0-9a-f-]{36}$/.test(bancoE2E))
      rmSync(bancoE2E, { recursive: true, force: true })
  }
}
