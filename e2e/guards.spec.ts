import { expect, test } from '@playwright/test'
import { loginWithCode, waitForHydration } from './helpers'

test.use({ storageState: { cookies: [], origins: [] } })

// Guarda das rotas protegidas: o que nunca pode quebrar.

test('/app anônimo vai para /login com o redirect de volta', async ({
  page,
}) => {
  await page.goto('/app')
  await expect(page).toHaveURL(/\/login\?redirect=%2Fapp$/)
  await expect(page.getByPlaceholder('voce@exemplo.com')).toBeVisible()
})

test('depois do login, volta para a página que pediu', async ({ page }) => {
  // A query `?de=e2e` prova que o destino veio do `redirect`: sem ele o
  // login cairia no padrão, `/app` puro.
  await page.goto('/app/conta?de=e2e')
  await expect(page).toHaveURL(/\/login\?redirect=%2Fapp%2Fconta%3Fde%3De2e$/)

  const email = `qa-volta-${Date.now()}@exemplo.test`
  await loginWithCode(page, email)

  await expect(page).toHaveURL(/\/app\/conta\?de=e2e$/)
  await expect(page.getByText(email).first()).toBeVisible()
  const sair = page.getByRole('button', { name: 'Sair', exact: true })
  await waitForHydration(sair)
  await sair.click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto('/app/conta')
  await expect(page).toHaveURL(/\/login\?redirect=/)
})
