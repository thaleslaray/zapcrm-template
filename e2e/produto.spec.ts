import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers'

test('rota inexistente responde 404 com a página própria', async ({ page }) => {
  const response = await page.goto('/nao-existe')
  expect(response?.status()).toBe(404)
  await expect(page.getByText('Página não encontrada')).toBeVisible()
})

test('a gestora navega pelas áreas e escolhe o funil de Pós-venda', async ({
  page,
}) => {
  await page.goto('/app/conversas')
  const nav = page.getByRole('navigation', { name: 'Área logada' })
  await waitForHydration(nav.getByRole('link', { name: 'Funil', exact: true }))
  for (const nome of [
    'Funil',
    'Contatos',
    'Retornos',
    'Configurações',
    'Conversas',
  ]) {
    await nav.getByRole('link', { name: nome, exact: true }).click()
    await expect(
      nav.getByRole('link', { name: nome, exact: true }),
    ).toHaveAttribute('aria-current', 'page')
    if (nome === 'Funil') {
      const pos = page.getByRole('tab', { name: 'Pós-venda' })
      await waitForHydration(pos)
      await pos.click()
      await expect(
        page.getByRole('region', { name: 'Instalação agendada', exact: true }),
      ).toBeVisible()
    }
  }
  await expect(
    page.getByRole('heading', { name: 'Conversas', exact: true }),
  ).toBeVisible()
})

test('a sessão volta a Conversas quando o destino de login é externo', async ({
  page,
}) => {
  const res = await page.goto('/login?redirect=/.//evil.com')
  expect(res?.status()).toBeLessThan(500)
  await expect(page).toHaveURL(/localhost:\d+\/app\/conversas$/)
  expect(res?.headers()['cache-control']).toBe('no-store')
})

test('o tema escolhido continua aplicado ao recarregar', async ({ page }) => {
  await page.goto('/app/conversas')
  const alternar = page.getByRole('button', {
    name: 'Mudar para o modo escuro',
  })
  await waitForHydration(alternar)
  await alternar.click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)
})
