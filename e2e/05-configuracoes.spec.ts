import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { expect, type Locator, type Page, test } from '@playwright/test'
import {
  emailGestora,
  executarSqlE2E,
  loginWithCode,
  waitForHydration,
} from './helpers'

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

async function abrir(page: Page, url: string) {
  await page.goto(url)
  await waitForHydration(page.locator('main'))
}

function botao(alvo: Page | Locator, name: string) {
  return alvo.getByRole('button', { name, exact: true })
}

async function salvar(page: Page) {
  const dialogo = page.getByRole('dialog')
  await botao(dialogo, 'Salvar').click()
  await expect(dialogo).toBeHidden()
}

async function perderResposta(page: Page, campo: Locator, valor: string) {
  const dialogo = page.getByRole('dialog')
  const rota = '**/_serverFn/**'
  let gravou = false
  await page.route(rota, async (pedido) => {
    if (pedido.request().method() !== 'POST' || gravou) return pedido.continue()
    const resposta = await pedido.fetch()
    expect(resposta.ok()).toBe(true)
    gravou = true
    await pedido.abort('connectionreset')
  })
  try {
    await botao(dialogo, 'Salvar').click()
    await expect(dialogo.getByRole('alert')).toBeVisible()
    await expect(campo).toHaveValue(valor)
    expect(gravou).toBe(true)
  } finally {
    await page.unroute(rota)
  }
  await botao(dialogo, 'Salvar').dblclick()
  await expect(dialogo).toBeHidden()
}

async function capturas(page: Page, secao: string) {
  const pasta = process.env.ZAPCRM_CAPTURAS_05
  if (!pasta) return
  await mkdir(pasta, { recursive: true })
  for (const modo of ['claro', 'escuro']) {
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width)
      await page.mouse.move(width - 1, 1)
      await page.screenshot({
        path: path.join(pasta, `${secao}-${width}-${modo}.png`),
        animations: 'disabled',
      })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await botao(
      page,
      `Mudar para o modo ${modo === 'claro' ? 'escuro' : 'claro'}`,
    ).click()
    if (modo === 'claro') await expect(page.locator('html')).toHaveClass(/dark/)
  }
}

test('J1 · H45 · primeira gestora libera um setor à segunda pessoa e a sessão respeita esse limite até sair', async ({
  page: gestora,
  browser,
  baseURL,
}) => {
  const contexto = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  })
  const email = 'qa-segunda-j1@exemplo.test'
  try {
    const segunda = await contexto.newPage()
    await segunda.goto('/login')
    await loginWithCode(segunda, email)
    await expect(
      segunda.getByRole('heading', { name: /Aguardando o gestor/ }),
    ).toBeVisible()
    await abrir(gestora, '/app/configuracoes?secao=equipe')
    const lista = gestora.locator('.lrow')
    await expect(lista.filter({ hasText: emailGestora })).toContainText(
      /gestor/i,
    )
    await lista.filter({ hasText: email }).getByRole('button').click()
    const dialogo = gestora.getByRole('dialog')
    await dialogo
      .getByRole('checkbox', { name: 'Pós-venda', exact: true })
      .check()
    const rpc = gestora.waitForRequest(
      (r) => r.method() === 'POST' && !!r.postData()?.includes('editarPessoa'),
    )
    await salvar(gestora)
    await expect(lista.filter({ hasText: email })).toContainText('Pós-venda')
    await abrir(segunda, '/app/funil?funil=pos')
    await expect(segunda.getByRole('tab', { name: 'Pós-venda' })).toBeVisible()
    await expect(
      segunda.getByRole('tab', { name: 'Vendas', exact: true }),
    ).toHaveCount(0)
    await expect(
      segunda.getByRole('link', { name: 'Configurações', exact: true }),
    ).toHaveCount(0)
    for (const url of [
      '/app/funil?funil=vendas',
      '/app/configuracoes?secao=equipe',
      '/app/configuracoes?secao=funis',
      '/app/configuracoes?secao=setores',
    ]) {
      await abrir(segunda, url)
      await expect(
        segunda.getByRole('heading', { name: 'Sem acesso' }),
      ).toBeVisible()
    }
    const pedido = await rpc
    const negado = await segunda.request.post(pedido.url(), {
      headers: {
        'content-type': pedido.headers()['content-type'],
        'x-tsr-serverfn': 'true',
        origin: new URL(pedido.url()).origin,
      },
      data: pedido.postData() ?? '',
    })
    expect(await negado.text()).toMatch(/Sem acesso/i)
    await abrir(segunda, '/app/conta')
    await botao(segunda, 'Sair').click()
    await expect(segunda).toHaveURL(/\/login/)
    await segunda.goto('/app/configuracoes')
    await expect(segunda).toHaveURL(/\/login/)
  } finally {
    await contexto.close()
    executarSqlE2E(`DELETE FROM user WHERE email='${email}'`)
  }
})

test('J5 · H41a · cria um setor, conserva o nome após perda da resposta e não duplica ao repetir', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const nome = 'Instalações da J5'
  try {
    await abrir(page, '/app/configuracoes?secao=setores')
    const novo = botao(page, 'Novo setor')
    await expect(novo).toBeEnabled()
    await novo.click()
    const campo = page.getByRole('dialog').getByLabel('Nome', { exact: true })
    await campo.fill(nome)
    await perderResposta(page, campo, nome)
    await abrir(page, '/app/configuracoes?secao=setores')
    await expect(
      page.getByRole('heading', { name: nome, exact: true }),
    ).toHaveCount(1)
    await botao(page, `Editar setor ${nome}`).click()
    await campo.fill('Instalações elétricas J5')
    await salvar(page)
    await botao(page, 'Editar setor Instalações elétricas J5').click()
    await botao(page.getByRole('dialog'), 'Apagar setor').click()
    await botao(page.getByRole('dialog'), 'Apagar').click()
    await expect(
      page.getByRole('heading', { name: 'Instalações elétricas J5' }),
    ).toHaveCount(0)
  } finally {
    executarSqlE2E(
      "DELETE FROM setores WHERE nome IN ('Instalações da J5','Instalações elétricas J5')",
    )
  }
})

test('J5 · H42–42a · cria funil e etapa, reordena, define fechamento e indica o número de entrada', async ({
  page,
}) => {
  executarSqlE2E(
    "INSERT INTO numeros(id,nome,cor,setor_id,funil_padrao_id) VALUES('j5-linha','Linha J5','#0f766e','com','vendas')",
  )
  try {
    await abrir(page, '/app/configuracoes?secao=funis')
    await botao(page, 'Novo funil').click()
    const dialogo = page.getByRole('dialog')
    const nome = dialogo.getByLabel('Nome', { exact: true })
    await nome.fill('Expansão J5')
    await dialogo
      .getByLabel('Setor', { exact: true })
      .selectOption({ label: 'Comercial' })
    await perderResposta(page, nome, 'Expansão J5')
    await page.getByRole('tab', { name: 'Expansão J5' }).click()
    await botao(page, 'Nova etapa').click()
    await nome.fill('Avaliação')
    await perderResposta(page, nome, 'Avaliação')
    await botao(page, 'Editar etapa Avaliação').click()
    await nome.fill('Vistoria')
    await dialogo.getByLabel('Cor', { exact: true }).fill('#224488')
    await salvar(page)
    await botao(page, 'Mover etapa Vistoria').click()
    await dialogo.getByLabel('Posição', { exact: true }).selectOption('1')
    await salvar(page)
    await botao(page, 'Nova etapa').click()
    await nome.fill('Contrato assinado')
    await dialogo
      .getByLabel('Fechamento', { exact: true })
      .selectOption('sucesso')
    await salvar(page)
    await botao(page, 'Definir número de entrada').click()
    await dialogo.getByLabel('Número', { exact: true }).selectOption('j5-linha')
    await salvar(page)
    await abrir(page, '/app/configuracoes?secao=funis')
    await page.getByRole('tab', { name: 'Expansão J5' }).click()
    await expect(page.locator('.fhead')).toContainText('Linha J5')
    const etapas = page
      .locator('.lrow')
      .filter({ has: page.getByRole('button', { name: /Editar etapa/ }) })
    await expect(etapas.nth(0)).toContainText('Vistoria')
    await expect(etapas).toHaveCount(3)
    await expect(etapas.filter({ hasText: 'Contrato assinado' })).toContainText(
      'sucesso',
    )
  } finally {
    executarSqlE2E(
      "DELETE FROM numeros WHERE id='j5-linha'; DELETE FROM funis WHERE nome='Expansão J5'",
    )
  }
})

test('J5 · H41 · convida fora da lista, cancela convite e remove a pessoa já autenticada', async ({
  page,
  browser,
  baseURL,
}) => {
  const email = 'instaladora-j5@exemplo.test'
  const pendente = 'convite-cancelado-j5@exemplo.test'
  const contexto = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  })
  try {
    await abrir(page, '/app/configuracoes?secao=equipe')
    const dialogo = page.getByRole('dialog')
    for (const endereco of [pendente, email]) {
      await botao(page, 'Convidar').click()
      const campo = dialogo.getByLabel('E-mail', { exact: true })
      await campo.fill(endereco)
      await dialogo
        .getByRole('checkbox', { name: 'Pós-venda', exact: true })
        .check()
      await perderResposta(page, campo, endereco)
      await expect(page.getByLabel('Endereço de entrada')).toHaveValue(
        `${baseURL}/login`,
      )
      await page
        .context()
        .grantPermissions(['clipboard-read', 'clipboard-write'])
      await botao(page, 'Copiar endereço').click()
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe(`${baseURL}/login`)
      if (endereco === pendente) {
        await page
          .locator('.lrow')
          .filter({ hasText: pendente })
          .getByRole('button')
          .click()
        await botao(dialogo, 'Cancelar convite').click()
        await expect(
          page.locator('.lrow').filter({ hasText: pendente }),
        ).toHaveCount(0)
      }
    }
    const pessoa = await contexto.newPage()
    await pessoa.goto('/login')
    await loginWithCode(pessoa, email)
    await expect(pessoa).toHaveURL(/\/app\/conversas$/)
    await abrir(pessoa, '/app/funil?funil=pos')
    await expect(pessoa.getByRole('tab', { name: 'Pós-venda' })).toBeVisible()
    await expect(
      pessoa.getByRole('tab', { name: 'Vendas', exact: true }),
    ).toHaveCount(0)
    await abrir(page, '/app/configuracoes?secao=equipe')
    const linha = page.locator('.lrow').filter({ hasText: email })
    await expect(linha).toHaveCount(1)
    await linha.getByRole('button').click()
    await botao(dialogo, 'Remover pessoa').click()
    await botao(dialogo, 'Remover').click()
    await expect(linha).toHaveCount(0)
    await pessoa.reload()
    await expect(pessoa).toHaveURL(/\/login/)
  } finally {
    await contexto.close()
    executarSqlE2E(
      `DELETE FROM convites WHERE email IN ('${email}','${pendente}'); DELETE FROM acessos_revogados WHERE email IN ('${email}','${pendente}'); DELETE FROM user WHERE email='${email}'`,
    )
  }
})

test('J5 · H41–42 · mostra vínculos persistidos e explica por que a etapa ocupada fica protegida', async ({
  page,
}) => {
  try {
    executarSqlE2E(`
      INSERT INTO user(id,name,email) VALUES
        ('j5-caio','Caio Mendes','caio.j5@exemplo.test'),
        ('j5-larissa','Larissa Okada','larissa.j5@exemplo.test'),
        ('j5-tiago','Tiago Ribeiro','tiago.j5@exemplo.test');
      INSERT INTO pessoas(usuario_id,papel) VALUES ('j5-caio','vendedor'),('j5-larissa','vendedor'),('j5-tiago','vendedor');
      INSERT INTO pessoas_setores(usuario_id,setor_id) VALUES ('j5-caio','com'),('j5-larissa','com'),('j5-larissa','pos'),('j5-tiago','pos');
      INSERT INTO numeros(id,nome,telefone,cor,setor_id,funil_padrao_id,estado) VALUES
        ('j5-com','Comercial','+55 11 4002-8922','#0f766e','com','vendas','conectado'),
        ('j5-pos','Pós-venda','+55 11 4002-8923','#2563eb','pos','pos','desconectado');
      INSERT INTO contatos(id,nome) VALUES ('j5-contato','Pessoa de teste J5');
      INSERT INTO negocios(id,contato_id,funil_id,etapa_id,numero_id) VALUES ('j5-historico','j5-contato','vendas','proposta','j5-com');
    `)
    await abrir(page, '/app/configuracoes?secao=setores')
    const comercial = page.getByRole('article').filter({
      has: page.getByRole('heading', { name: 'Comercial', exact: true }),
    })
    for (const texto of ['4002-8922', 'Vendas', 'Caio Mendes', 'Larissa Okada'])
      await expect(comercial).toContainText(texto)
    await expect(comercial).not.toContainText('Tiago Ribeiro')
    await capturas(page, 'setores')
    await abrir(page, '/app/configuracoes?secao=equipe')
    const larissa = page.locator('.lrow').filter({ hasText: 'Larissa Okada' })
    await expect(larissa).toContainText('Comercial')
    await expect(larissa).toContainText('Pós-venda')
    await capturas(page, 'equipe')
    await abrir(page, '/app/configuracoes?secao=funis')
    await capturas(page, 'funis')
    await botao(page, 'Editar etapa Proposta').click()
    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toContainText(
      'Esta etapa tem negócios e não pode ser apagada.',
    )
    await expect(botao(dialogo, 'Apagar etapa')).toBeDisabled()
  } finally {
    executarSqlE2E(
      `DELETE FROM contatos WHERE id='j5-contato'; DELETE FROM numeros WHERE id IN ('j5-com','j5-pos'); DELETE FROM user WHERE id IN ('j5-caio','j5-tiago','j5-larissa')`,
    )
  }
})
