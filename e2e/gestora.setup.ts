import { expect, test as setup } from '@playwright/test'
import { emailGestora, loginWithCode, sessaoGestora } from './helpers'

setup('entra uma vez e guarda a sessão da gestora', async ({ page }) => {
  await page.goto('/login')
  await loginWithCode(page, emailGestora)
  await expect(page).toHaveURL(/\/app\/conversas$/)
  await expect(
    page.getByRole('link', { name: 'Configurações', exact: true }),
  ).toBeVisible()
  await page.context().storageState({ path: sessaoGestora })
})
