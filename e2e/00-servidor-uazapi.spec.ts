import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { executarSqlE2E, loginWithCode, waitForHydration } from './helpers'
import { controle, segredosLocais } from './whatsapp-suporte'

test.use({
  trace: 'off',
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
})

async function capturar(page: Page, nome: string) {
  const pasta = process.env.ZAPCRM_CAPTURAS_C3
  if (!pasta) return
  await mkdir(pasta, { recursive: true })
  await page.mouse.move(0, 0)
  await page.screenshot({
    path: path.join(pasta, `${nome}.png`),
    animations: 'disabled',
  })
}

test('C3 · gestor valida o servidor e adiciona um número; vendedor não acessa a configuração', async ({
  page,
  request,
  browser,
  baseURL,
}) => {
  const nome = 'Atendimento C3'
  const email = 'qa-vendedor-c3@exemplo.test'
  const local = await segredosLocais()
  const invalido = 'token-de-teste-recusado-c3'
  const corpos: Promise<string>[] = []
  page.on('response', (resposta) => {
    if (
      ['document', 'fetch', 'xhr'].includes(resposta.request().resourceType())
    )
      corpos.push(resposta.text().catch(() => ''))
  })
  const caminho = '/app/configuracoes?secao=numeros'
  await page.goto(caminho)
  const secao = page.getByRole('region', { name: 'Servidor uazapi' })
  await expect(secao).toBeVisible()
  const endereco = secao.getByLabel('Endereço do servidor')
  const token = secao.getByLabel('Token de administração')
  const salvar = secao.getByRole('button', { name: 'Salvar servidor' })
  const remover = secao.getByRole('button', { name: 'Remover configuração' })
  await waitForHydration(endereco)
  await expect(token).toHaveAttribute('type', 'password')
  await expect(token).toHaveValue('')
  await expect(remover).toHaveCount(0)
  await controle(request, 'preparar', nome)
  try {
    await endereco.fill(local.UAZAPI_URL)
    await token.fill(invalido)
    const chamada = page.waitForRequest(
      (req) =>
        req.url().includes('/_serverFn/') &&
        !!req.postData()?.includes(invalido),
    )
    await salvar.click()
    const postagem = await chamada
    expect(postagem.method()).toBe('POST')
    const entreSites = await page.request.post(postagem.url(), {
      headers: {
        origin: 'https://outro.exemplo.test',
        'sec-fetch-site': 'cross-site',
      },
    })
    expect(entreSites.status()).toBe(403)
    await expect(secao.getByRole('alert')).toContainText(/token.*recusado/i)
    await expect(remover).toHaveCount(0)
    await token.fill(local.UAZAPI_ADMIN_TOKEN)
    await salvar.click()
    await expect(secao).toContainText(/Salvo por qa-gestora/)
    await expect(page.getByText(/Agora conecte um número/)).toBeVisible()
    // Depois de salvo, o formulário recolhe e a tela aponta o próximo passo.
    await expect(endereco).toBeHidden()
    await page.reload()
    const trocar = secao.getByRole('button', { name: 'Trocar servidor' })
    await waitForHydration(trocar)
    await expect(secao).toContainText('Conectado a 127.0.0.1:3233')
    await expect(secao.locator('time')).toBeVisible()
    await expect(endereco).toBeHidden()
    await trocar.click()
    await expect(token).toHaveValue('')
    await page
      .getByRole('button', { name: 'Conectar número', exact: true })
      .click()
    const catalogo = page.getByRole('dialog')
    await catalogo.getByRole('checkbox', { name: nome, exact: true }).check()
    await catalogo
      .getByRole('button', { name: 'Adicionar selecionados' })
      .click()
    const numero = page.getByRole('article').filter({ hasText: nome })
    await expect(numero).toContainText('Conectado')
    await capturar(page, 'servidor-claro')
    await page.getByRole('button', { name: 'Mudar para o modo escuro' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await capturar(page, 'servidor-escuro')
    await page.getByRole('button', { name: 'Mudar para o modo claro' }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(secao).toBeVisible()
    await expect(token).toBeInViewport()
    await capturar(page, 'servidor-celular')

    const vendedor = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    })
    try {
      const outra = await vendedor.newPage()
      await outra.goto('/login')
      await loginWithCode(outra, email)
      await expect(outra).toHaveURL(/app\/conversas/)
      await outra.goto(caminho)
      await expect(
        outra.getByRole('heading', { name: 'Sem acesso' }),
      ).toBeVisible()
      await expect(
        outra.getByRole('region', { name: 'Servidor uazapi' }),
      ).toHaveCount(0)
    } finally {
      await vendedor.close()
    }

    await endereco.fill('http://localhost:3233')
    await token.fill(local.UAZAPI_ADMIN_TOKEN)
    await salvar.click()
    const confirmacao = page.getByRole('dialog')
    await expect(
      confirmacao.getByRole('heading', { name: 'Trocar servidor?' }),
    ).toBeVisible()
    await expect(confirmacao).toContainText(/desconectad/)
    await confirmacao
      .getByRole('button', { name: 'Fechar', exact: true })
      .last()
      .click()
    await expect(numero).toContainText('Conectado')
    await expect(secao).toContainText('Conectado a 127.0.0.1:3233')
    await secao.getByRole('button', { name: 'Cancelar' }).click()
    await remover.click()
    await expect(confirmacao).toContainText(/desconectad/)
    await confirmacao
      .getByRole('button', { name: 'Fechar', exact: true })
      .last()
      .click()
    await expect(remover).toBeVisible()
    await remover.click()
    await confirmacao.getByRole('button', { name: 'Remover servidor' }).click()
    await expect(remover).toHaveCount(0)
    await expect(numero).toContainText('Desconectado')
    await expect(secao).toContainText('Configurado nos segredos do Worker')
    await numero.getByRole('button', { name: 'Reconectar' }).click()
    const parear = page.getByRole('dialog')
    const vincular = parear.getByRole('button', {
      name: 'Vincular e reconectar',
    })
    await expect(vincular).toBeDisabled()
    await parear
      .getByLabel('Instância do servidor')
      .selectOption({ label: nome })
    await vincular.click()
    await expect(
      parear.getByRole('heading', { name: `${nome} conectado` }),
    ).toBeVisible()
    const respostaELog = [
      ...(await Promise.all(corpos)),
      await readFile('e2e/.dev.log', 'utf8'),
    ].join('\n')
    for (const segredo of [local.UAZAPI_ADMIN_TOKEN, invalido]) {
      expect(respostaELog.includes(segredo)).toBe(false)
    }
  } finally {
    executarSqlE2E(
      "DELETE FROM servidor_uazapi; DELETE FROM numeros WHERE nome='Atendimento C3'; DELETE FROM user WHERE email='qa-vendedor-c3@exemplo.test'",
    )
    await controle(request, 'remover', nome)
  }
})
