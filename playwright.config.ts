import { defineConfig, devices } from '@playwright/test'
import { bancoE2E, devPort, previewPort, sessaoGestora } from './e2e/helpers'

// Testes ponta a ponta contra o servidor de desenvolvimento real (`vite dev`:
// workerd + D1 local). `npm run e2e` sobe o servidor sozinho. A saída vai para
// e2e/.dev.log: é dali que o teste de login lê o código impresso no terminal.
// Porta 3000 ocupada? `E2E_PORT=3001 npm run e2e` (a URL do app vem da
// requisição, então não precisa mexer no .dev.vars). Veja e2e/README.md.
// O servidor de desenvolvimento sobe com VITE_E2E_SEM_LIMITE=1: o limite de
// pedidos de login fica desligado só ali (veja `isRateLimited`).
// O segundo servidor (preview, porta 4173 ou E2E_PREVIEW_PORT) é a saída de
// produção: faz o build e serve com o public/_headers aplicado aos estáticos.
const port = devPort
const baseURL = `http://localhost:${port}`

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // Um servidor só, uma porta só: sem paralelismo entre arquivos.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    actionTimeout: 15_000,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'setup', testMatch: /gestora\.setup\.ts$/ },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: sessaoGestora },
    },
  ],
  webServer: [
    {
      command: 'node --env-file=.dev.vars e2e/uazapi/servidor.mjs',
      env: { E2E_PORT: String(port) },
      url: 'http://127.0.0.1:3233/status',
      reuseExistingServer: false,
    },
    {
      // `--strictPort`: se a porta estiver ocupada, falha em vez de pular para outra.
      env: { ZAPCRM_E2E_STATE: bancoE2E },
      command: `VITE_E2E_SEM_LIMITE=1 npx vite dev --port ${port} --strictPort > e2e/.dev.log 2>&1`,
      url: `${baseURL}/login`,
      // Sempre sobe o próprio servidor: o login precisa do log em e2e/.dev.log.
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // `npm run preview` = build + `vite preview` (workerd com a camada de
      // assets de produção). Só o security-headers.spec.ts usa este servidor.
      command: `npm run preview -- --port ${previewPort} --strictPort`,
      url: `http://localhost:${previewPort}/termos`,
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
})
