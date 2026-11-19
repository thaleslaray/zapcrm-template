import { expect, test } from '@playwright/test'
import { executarSqlE2E, waitForHydration } from './helpers'

function prepararNumero() {
  executarSqlE2E(
    "INSERT OR IGNORE INTO numeros(id,nome,cor,setor_id,funil_padrao_id,estado) VALUES ('j2-com','Comercial J2','#0f766e','com','vendas','conectado')",
  )
}

test.afterAll(() => {
  executarSqlE2E(`
    DELETE FROM contatos WHERE id IN (SELECT contato_id FROM conversas WHERE numero_id='j2-com');
    DELETE FROM numeros WHERE id='j2-com';`)
})

test('J2 · H16–17d, H23–27, H29–32 · do contato ao pós-venda', async ({
  page,
}) => {
  prepararNumero()
  await page.goto('/app/contatos')
  const novo = page.getByRole('button', { name: 'Novo contato' })
  await waitForHydration(novo)
  await novo.click()
  const formulario = page.getByRole('dialog')
  await expect(
    formulario.getByRole('radio', { name: /Comercial J2/ }),
  ).toBeVisible()
  const sufixo = String(Date.now()).slice(-8)
  const nome = 'Marina J2 ' + sufixo
  await formulario.getByLabel('Nome', { exact: true }).fill(nome)
  await formulario.getByLabel('Telefone', { exact: true }).fill('119' + sufixo)
  await formulario.getByRole('radio', { name: /Comercial J2/ }).check()
  await formulario
    .getByRole('button', { name: 'Salvar e abrir conversa' })
    .click()
  const painel = page.getByRole('complementary', { name: 'Painel do contato' })
  await expect(painel.getByRole('heading', { name: nome })).toBeVisible()
  const urlContato = page.url()
  const novoNegocio = painel.getByRole('button', { name: 'Novo negócio' })
  await waitForHydration(novoNegocio)
  await novoNegocio.click()
  const abertura = page.getByRole('dialog', { name: 'Novo negócio' })
  await abertura
    .getByRole('combobox', { name: 'Funil' })
    .selectOption({ label: 'Vendas' })
  await abertura.getByRole('button', { name: 'Abrir negócio' }).click()
  await expect(
    painel.getByRole('button', { name: 'Mover para Proposta' }),
  ).toBeVisible()
  await painel.getByRole('button', { name: 'Novo negócio' }).click()
  await page.getByRole('menuitem', { name: /Vendas/ }).click()
  await expect(painel.getByRole('alert')).toContainText(/aberto/i)
  await painel.getByRole('button', { name: 'Editar' }).click()
  const editar = page.getByRole('dialog')
  await editar.getByLabel('Empresa').fill('Padaria Pão Dourado')
  await editar
    .getByLabel('Valor do negócio (R$)', { exact: true })
    .fill('42800,50')
  await editar.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(painel).toContainText('42.800,50')
  await page.goto('/app/contatos')
  await waitForHydration(novo)
  await novo.click()
  await formulario.getByLabel('Telefone', { exact: true }).fill('11' + sufixo)
  await expect(formulario).toContainText(/Este telefone já é de/i)
  await formulario.getByText('Abrir contato', { exact: true }).click()
  await expect(painel.getByRole('heading', { name: nome })).toBeVisible()
  await page.goto('/app/funil?funil=vendas')
  const cartao = page.getByRole('article').filter({ hasText: nome })
  const proposta = page.getByRole('region', { name: 'Proposta', exact: true })
  await waitForHydration(cartao)
  await cartao.dragTo(proposta)
  await expect(
    proposta.getByRole('article').filter({ hasText: nome }),
  ).toBeVisible()
  await page.reload()
  await expect(
    proposta.getByRole('article').filter({ hasText: nome }),
  ).toBeVisible()
  await cartao.getByRole('link', { name: /Abrir conversa/ }).click()
  await painel.getByRole('button', { name: 'Mover para Ganho' }).click()
  await expect(page.getByText(/Negócio criado no Pós-venda/)).toBeVisible()
  await page.getByRole('button', { name: 'Ver', exact: true }).click()
  await expect(page).toHaveURL(/funil=pos/)
  await expect(cartao).toContainText(/Venda|Origem/i)
  await page.setViewportSize({ width: 390, height: 844 })
  await cartao.getByRole('button', { name: 'Mover para…' }).click()
  await page.getByRole('menuitem', { name: 'Concluído', exact: true }).click()
  await expect(
    page.getByText('Movido para Concluído', { exact: true }),
  ).toBeVisible()
  await page.goto(urlContato)
  const abrirPainel = page.getByRole('button', {
    name: 'Abrir painel do contato',
  })
  await waitForHydration(abrirPainel)
  await abrirPainel.click()
  await painel.getByRole('button', { name: /Histórico de negócios/ }).click()
  const historico = painel.getByRole('list')
  await expect(historico.getByRole('listitem')).toHaveCount(2)
  await expect(historico.getByRole('listitem').first()).toContainText(
    'Concluído',
  )
  await expect(historico.getByRole('listitem').last()).toContainText('Ganho')
  await painel.getByRole('button', { name: 'Apagar contato' }).click()
  await expect(page.getByRole('dialog')).toContainText(
    '1 conversa e 2 negócios',
  )
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Apagar contato' })
    .click()
  await expect(page).toHaveURL(/\/app\/contatos/)
  await expect(page.getByText(nome, { exact: true })).toHaveCount(0)
})

test('J2 · H17c, H31 · a resposta perdida e o clique duplo preservam um único cadastro', async ({
  page,
}) => {
  prepararNumero()
  await page.goto('/app/contatos')
  const novo = page.getByRole('button', { name: 'Novo contato' })
  await waitForHydration(novo)
  await novo.click()
  const dialogo = page.getByRole('dialog')
  const sufixo = String(Date.now()).slice(-8)
  const nome = 'Cliente J2 ' + sufixo
  await dialogo.getByLabel('Nome', { exact: true }).fill(nome)
  await dialogo.getByLabel('Telefone', { exact: true }).fill('119' + sufixo)
  await dialogo.getByRole('radio', { name: /Comercial J2/ }).check()
  let perdeuResposta = false
  await page.route('**/_serverFn/**', async (rota) => {
    if (
      !perdeuResposta &&
      rota.request().method() === 'POST' &&
      rota.request().postData()?.includes('criarContato')
    ) {
      perdeuResposta = true
      await rota.fetch()
      return rota.abort('connectionreset')
    }
    return rota.continue()
  })
  const salvar = dialogo.getByRole('button', {
    name: 'Salvar e abrir conversa',
  })
  await salvar.click()
  await expect(dialogo.getByRole('alert')).toBeVisible()
  expect(perdeuResposta).toBe(true)
  await expect(dialogo.getByLabel('Nome', { exact: true })).toHaveValue(nome)
  // Uma segunda aba vê a primeira gravação, embora a resposta nunca tenha chegado ao formulário.
  const consulta = await page.context().newPage()
  try {
    await consulta.goto('/app/contatos')
    await expect(
      consulta.getByRole('row').filter({ hasText: nome }),
    ).toHaveCount(1)
  } finally {
    await consulta.close()
  }
  await salvar.dblclick()
  await expect(page).toHaveURL(/\/app\/conversas\?/)
  await page.goto('/app/contatos')
  await expect(page.getByRole('row').filter({ hasText: nome })).toHaveCount(1)
})

test('J2 · H16, H32 · Conversas abre o painel do contato persistido também pela navegação principal', async ({
  page,
}) => {
  prepararNumero()
  executarSqlE2E(
    `
    INSERT OR IGNORE INTO contatos(id,nome) VALUES ('j2-entrada','Loja do Centro J2');
    INSERT INTO conversas(id,contato_id,numero_id,ultima_mensagem_em)
      VALUES ('j2-entrada-conversa','j2-entrada','j2-com',unixepoch('now')*1000)
      ON CONFLICT(id) DO UPDATE SET ultima_mensagem_em=excluded.ultima_mensagem_em;`,
  )
  await page.goto('/app/conversas')
  const painel = page.getByRole('complementary', { name: 'Painel do contato' })
  await expect(
    painel.getByRole('heading', { name: 'Loja do Centro J2' }),
  ).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: /Loja do Centro J2/ }).click()
  await page.getByRole('button', { name: 'Abrir painel do contato' }).click()
  await expect(
    painel.getByRole('heading', { name: 'Loja do Centro J2' }),
  ).toBeVisible()
})
