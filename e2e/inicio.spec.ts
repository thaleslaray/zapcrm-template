import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers'

test.use({ storageState: { cookies: [], origins: [] } })

test('a entrada do ZapCRM leva a pessoa sem sessão ao login', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login\?redirect=/)
  await expect(
    page.getByRole('button', { name: 'Entrar com código no e-mail' }),
  ).toBeVisible()
})

test('o formulário pede o código da mesma forma para os dois e-mails', async ({
  page,
}) => {
  const respostas = []
  for (const email of [
    'qa-permitida@exemplo.test',
    'fora-da-lista@exemplo.test',
  ]) {
    await page.goto('/login')
    const campo = page.getByLabel('E-mail', { exact: true })
    await waitForHydration(campo)
    await campo.fill(email)
    await page
      .getByRole('button', { name: 'Entrar com código no e-mail' })
      .click()
    await expect(page.getByLabel('Código', { exact: true })).toBeVisible()
    const mensagem = await page
      .getByText('Enviamos um código de 6 dígitos')
      .innerText()
    respostas.push(mensagem.replace(email, '<e-mail>'))
  }
  expect(respostas[0]).toBe(respostas[1])
})
