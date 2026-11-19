import fs from 'node:fs'
import { expect, type Page, test } from '@playwright/test'
import { loginWithCode, waitForHydration } from './helpers'

// Conta descartável para testar o próprio encerramento sem revogar a sessão compartilhada.
test.describe.configure({ mode: 'serial' })
// PNG 1x1 válido (os primeiros bytes são conferidos pelo servidor).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
)

let page: Page
const email = `qa-e2e-${Date.now()}@exemplo.test`

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ storageState: { cookies: [], origins: [] } })
})

test.afterAll(async () => {
  await page.close()
})

test('vendedor entra sem setor, acessa sua conta e recebe o aviso ao abrir Configurações', async () => {
  await page.goto('/login')
  await loginWithCode(page, email)
  await expect(page).toHaveURL(/\/app\/conversas$/)
  await expect(
    page.getByText('Aguardando o gestor liberar um setor para você'),
  ).toBeVisible()
  await page.goto('/app/configuracoes')
  await expect(page.getByRole('heading', { name: 'Sem acesso' })).toBeVisible()
  await page.getByRole('link', { name: 'Minha conta' }).click()
  await expect(page.getByText(email, { exact: true })).toBeVisible()
})
test('troca a foto de perfil (R2)', async () => {
  const input = page.getByLabel('Foto de perfil')
  await waitForHydration(page.getByLabel('Nome'))
  await input.setInputFiles({
    name: 'foto.png',
    mimeType: 'image/png',
    buffer: PNG,
  })
  await page.getByRole('button', { name: 'Salvar foto' }).click()
  await expect(page.getByText('Foto atualizada')).toBeVisible()

  // A URL nova aponta para /api/avatar/<id>?v=..., e a imagem carrega.
  const src = await page
    .locator('img[src*="/api/avatar/"]')
    .first()
    .getAttribute('src')
  expect(src).toMatch(/^\/api\/avatar\/[\w-]+\?v=\d+$/)
  const res = await page.request.get(src ?? '')
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toBe('image/png')
  expect(res.headers().etag).toBeTruthy()
})

test('baixa os dados da conta em JSON', async () => {
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Baixar meus dados' }).click()
  const file = await (await download).path()
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  expect(data.conta.email).toBe(email)
  expect(data.foto?.url).toMatch(/^\/api\/avatar\//)
  const actions = data.auditoria.map((row: { action: string }) => row.action)
  expect(actions).toContain('auth.sign_in')
  expect(actions).toContain('account.avatar_set')
})
test('encerra a conta: sai na hora e /app volta a pedir login', async () => {
  await page.getByRole('button', { name: 'Encerrar conta' }).click()
  const dialog = page.getByRole('dialog')
  const confirm = dialog.getByRole('button', { name: 'Encerrar conta' })
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel(/Digite ENCERRAR/).fill('ENCERRAR')
  await confirm.click()

  await expect(page).toHaveURL(/\/login/)
  await page.goto('/app')
  await expect(page).toHaveURL(/\/login\?redirect=%2Fapp$/)
})
