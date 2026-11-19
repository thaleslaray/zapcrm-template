import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers'

test('a janela explica os dois tipos de histórico e inicia em 90 dias', async ({
  page,
}) => {
  await page.goto('/app/configuracoes?secao=numeros')
  const conectar = page.getByRole('button', {
    name: 'Conectar número',
    exact: true,
  })
  await waitForHydration(conectar)
  await conectar.click()
  await page.getByRole('button', { name: 'Criar número novo' }).click()
  const dias = page.getByRole('spinbutton', { name: 'Dias de histórico' })
  await expect(dias).toHaveValue('90')
  await expect(dias).toHaveAccessibleDescription(
    /1 a 90 dias.*normal.*91 a 365.*completo.*0/i,
  )
})
