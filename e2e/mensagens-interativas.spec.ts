import { mkdir } from 'node:fs/promises'
import { expect, type Page, test } from '@playwright/test'
import { executarSqlE2E, waitForHydration } from './helpers'
import { mensagensInterativas } from './uazapi/mensagens-interativas'
import { controle, emitir } from './whatsapp-suporte'

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

async function capturar(page: Page, modo: string) {
  if (!process.env.ZAPCRM_CAPTURAS_C7) return
  const pasta = '.scratch/zapcrm/capturas/c7'
  await mkdir(pasta, { recursive: true })
  await page.screenshot({
    path: `${pasta}/botoes-${modo}.png`,
    animations: 'disabled',
  })
}

test('C7 · exibe botões somente leitura, lista e escolha no balão e na prévia', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000)
  const numero = 'Atendimento C7'
  const { modelos, botoes, lista, resposta } = mensagensInterativas()
  await controle(request, 'preparar', numero, {
    mensagens: [...modelos, botoes],
  })
  try {
    await page.goto('/app/configuracoes?secao=numeros')
    const abrir = page.getByRole('button', {
      name: 'Conectar número',
      exact: true,
    })
    await waitForHydration(abrir)
    await abrir.click()
    await page.getByRole('checkbox', { name: numero, exact: true }).check()
    await page
      .getByLabel(`Setor de ${numero}`, { exact: true })
      .selectOption('com')
    await page
      .getByLabel(`Funil padrão de ${numero}`, { exact: true })
      .selectOption('vendas')
    await page.getByRole('button', { name: 'Adicionar selecionados' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.goto('/app/conversas')
    const chat = page.getByRole('log', { name: 'Mensagens' })
    const atendimento = page
      .locator('button.row')
      .filter({ hasText: 'Solar Atendimento' })
    await waitForHydration(atendimento)
    await atendimento.click()
    const fluxo = chat
      .locator('.bubble')
      .filter({ hasText: 'Como podemos ajudar?' })
    await expect(fluxo).toHaveCount(2)
    for (const modelo of await fluxo.all()) {
      await expect(
        modelo.getByText('Equipe Solar', { exact: true }),
      ).toBeVisible()
      await expect(
        modelo.getByLabel('Botão da mensagem: Consultar fatura', {
          exact: true,
        }),
      ).toBeVisible()
      await expect(modelo.locator('a')).toHaveCount(0)
      await expect(modelo).not.toContainText('fatura-privada')
    }
    const linha = page
      .locator('button.row')
      .filter({ hasText: botoes.senderName })
    const previa = linha.locator('.pv .t')
    await expect(previa).toContainText(
      'está disponível. Como deseja continuar?',
    )
    await waitForHydration(linha)
    await linha.click()
    const bolha = chat
      .locator('.bubble')
      .filter({ hasText: 'Como deseja continuar?' })
    await expect(bolha.locator('strong')).toHaveText('fatura')
    for (const rotulo of [
      'Código para pagamento',
      'Já efetuei o pagamento',
      'Bloquear',
    ]) {
      const opcao = bolha.getByLabel(`Botão da mensagem: ${rotulo}`, {
        exact: true,
      })
      await expect(opcao).toBeVisible()
      await expect(opcao).toHaveCSS('text-align', 'center')
      await expect(opcao).not.toHaveCSS('cursor', 'pointer')
    }
    await expect(bolha.locator('a,button,[tabindex="0"]')).toHaveCount(0)
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    await capturar(page, 'claro')
    await page.getByRole('button', { name: 'Mudar para o modo escuro' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await capturar(page, 'escuro')
    await page.getByRole('button', { name: 'Mudar para o modo claro' }).click()
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(bolha.getByText('Bloquear', { exact: true })).toBeInViewport()
    await capturar(page, 'celular')
    await page.setViewportSize({ width: 1440, height: 900 })

    await emitir(request, numero, { EventType: 'messages', message: lista })
    const bolhaLista = chat
      .locator('.bubble')
      .filter({ hasText: 'Escolha uma forma de pagamento.' })
    for (const rotulo of ['Formas de pagamento', 'Pix', 'Boleto']) {
      await expect(
        bolhaLista.getByLabel(`Botão da mensagem: ${rotulo}`, { exact: true }),
      ).toContainText(rotulo)
    }
    await expect(
      bolhaLista.getByText('Confirmação imediata', { exact: true }),
    ).toBeVisible()
    await expect(previa).toHaveText('Escolha uma forma de pagamento.')
    await emitir(request, numero, { EventType: 'messages', message: resposta })
    await expect(
      chat.locator('.out .bubble').getByText('Pix', { exact: true }),
    ).toBeVisible()
    await expect(previa).toHaveText('Pix')
  } finally {
    executarSqlE2E(
      "DELETE FROM contatos WHERE id IN (SELECT c.contato_id FROM conversas c JOIN numeros n ON n.id=c.numero_id WHERE n.nome='Atendimento C7'); DELETE FROM numeros WHERE nome='Atendimento C7'",
    )
    await controle(request, 'remover', numero)
  }
})
