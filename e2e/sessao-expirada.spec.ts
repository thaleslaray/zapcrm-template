import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers'

test('uma ação com a sessão expirada na página aberta volta ao login e preserva o destino', async ({
  page,
  context,
}) => {
  await page.goto('/app/conta')
  const baixar = page.getByRole('button', { name: 'Baixar meus dados' })
  await waitForHydration(baixar)
  await page.route('**/_serverFn/**', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    await context.clearCookies()
    const resposta = await route.fetch({
      headers: { ...route.request().headers(), cookie: '' },
    })
    expect(resposta.status()).toBe(401)
    await route.fulfill({ response: resposta })
  })
  await baixar.click()
  await expect(page).toHaveURL(/\/login\?redirect=%2Fapp%2Fconta/)
})
