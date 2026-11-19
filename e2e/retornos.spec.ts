import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { executarSqlE2E, loginWithCode, waitForHydration } from './helpers'

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const conversa = '/app/conversas?conversa=j4-conversa&painel=true'
const marina = 'Marina Lopes'
const motivo = 'Revisar a simulação de financiamento'
const dia = 86_400_000
const calendario = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo',
})

test.beforeAll(() => {
  executarSqlE2E(`
    INSERT INTO numeros (id,nome,cor,setor_id,funil_padrao_id,estado)
      VALUES ('j4-num','Comercial','#0f766e','com','vendas','conectado');
    INSERT INTO contatos (id,nome,empresa) VALUES
      ('j4-contato','Marina Lopes','Padaria Pão Dourado'),
      ('j4-bia','Beatriz Lima','Clínica Sorriso Pleno'),
      ('j4-renato','Renato Melo','Escola Pequeno Saber');
    INSERT INTO conversas (id,contato_id,numero_id) VALUES
      ('j4-conversa','j4-contato','j4-num'),('j4-v-bia','j4-bia','j4-num'),('j4-v-renato','j4-renato','j4-num');
    INSERT INTO negocios (id,contato_id,funil_id,etapa_id,numero_id,valor_centavos)
      VALUES ('j4-neg','j4-contato','vendas','proposta','j4-num',4280000),
             ('j4-neg-bia','j4-bia','vendas','novo','j4-num',1750000);
    INSERT INTO user (id,name,email) VALUES ('j4-vendedor','Caio Mendes','qa-j4-caio@exemplo.test');
    INSERT INTO pessoas (usuario_id,papel) VALUES ('j4-vendedor','vendedor');
    INSERT INTO pessoas_setores (usuario_id,setor_id) VALUES ('j4-vendedor','com');
    INSERT INTO etiquetas (id,nome,cor) VALUES
      ('j4-quente','Quente','#c2410c'), ('j4-indicacao','Indicação','#7c3aed'), ('j4-credito','Financiamento','#2563eb');
    INSERT INTO respostas_rapidas (id,atalho,texto) VALUES
      ('j4-ola','/ola','Olá! Aqui é o Caio, da Lumen Solar. Como posso te ajudar?'),
      ('j4-proposta','/proposta','Segue a proposta com o dimensionamento do seu sistema.');
    INSERT INTO retornos (id,contato_id,numero_id,responsavel_id,motivo,marcado_para) VALUES
      ('j4-r-bia','j4-bia','j4-num','j4-vendedor','Confirmar a visita técnica',${Date.now() + dia}),
      ('j4-r-renato','j4-renato','j4-num','j4-vendedor','Apresentar a proposta à diretoria',${Date.now() + 3 * dia});
  `)
})
test.afterAll(() => {
  executarSqlE2E(`
    DELETE FROM contatos WHERE id IN ('j4-contato','j4-bia','j4-renato');
    DELETE FROM numeros WHERE id='j4-num';
    DELETE FROM user WHERE id='j4-vendedor';
    DELETE FROM etiquetas WHERE nome IN ('Proposta J4','Visita técnica J4') OR id IN ('j4-quente','j4-indicacao','j4-credito');
    DELETE FROM respostas_rapidas WHERE atalho='/visitaj4' OR id IN ('j4-ola','j4-proposta');
  `)
})

async function abrir(page: Page, url: string) {
  await page.goto(url)
  await waitForHydration(page.locator('main'))
}

async function respostaPerdida(
  page: Page,
  texto: string,
  botao: Locator,
  campo: Locator,
  valor: string,
) {
  let gravou = false
  const rota = '**/_serverFn/**'
  await page.route(rota, async (r) => {
    if (
      !gravou &&
      r.request().method() === 'POST' &&
      r.request().postData()?.includes(texto)
    ) {
      const resposta = await r.fetch()
      expect(resposta.ok()).toBe(true)
      gravou = true
      return r.abort('connectionreset')
    }
    return r.continue()
  })
  try {
    await botao.click()
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: /confirmar|possível|falha|tente/i })
        .first(),
    ).toBeVisible()
    expect(gravou).toBe(true)
    await expect(campo).toHaveValue(valor)
  } finally {
    await page.unroute(rota)
  }
  await botao.dblclick()
}

async function capturas(page: Page, tela: string, foco?: Locator) {
  const pasta = process.env.ZAPCRM_CAPTURAS_04
  if (!pasta) return
  await mkdir(pasta, { recursive: true })
  async function capturar(destino: string, largura: number, modo: string) {
    await page.setViewportSize(
      largura === 390
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 },
    )
    await page.mouse.move(largura - 2, 2)
    await foco?.scrollIntoViewIfNeeded()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(largura)
    await page.screenshot({
      path: path.join(destino, `${tela}-${largura}-${modo}.png`),
      animations: 'disabled',
    })
  }
  for (const modo of ['claro', 'escuro']) {
    await capturar(pasta, 1440, modo)
    await capturar(pasta, 390, modo)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page
      .getByRole('button', {
        name: `Mudar para o modo ${modo === 'claro' ? 'escuro' : 'claro'}`,
      })
      .click()
    await expect(page.locator('html')).toHaveClass(
      modo === 'claro' ? /dark/ : /light/,
    )
  }
}

test('J4 · H19, H20, H33–36 · marca o retorno no painel e o encontra na agenda', async ({
  page,
}) => {
  await abrir(page, conversa)
  const painel = page.getByRole('complementary', { name: 'Painel do contato' })
  const marcar = painel.getByRole('button', { name: 'Marcar', exact: true })
  await expect(marcar).toBeVisible()
  await marcar.click()
  const janela = page.getByRole('dialog')
  await janela
    .getByLabel('Data', { exact: true })
    .fill(calendario.format(Date.now() + dia))
  await janela.getByLabel('Hora', { exact: true }).fill('10:30')
  const campo = janela.getByLabel('Motivo')
  const salvar = janela.getByRole('button', { name: 'Salvar', exact: true })
  await campo.fill(motivo)
  await respostaPerdida(page, 'financiamento', salvar, campo, motivo)
  await expect(painel).toContainText(motivo)
  const retornos = page.getByRole('link', { name: 'Retornos', exact: true })
  await retornos.click()
  const linha = page.locator('.agenda .item').filter({ hasText: marina })
  const grupo = (nome: string) =>
    page
      .locator('.agenda section')
      .filter({ has: page.getByRole('heading', { name: new RegExp(nome) }) })
  await expect(grupo('Amanhã')).toContainText(motivo)
  await linha.getByRole('link', { name: 'Abrir conversa' }).click()
  await waitForHydration(painel)
  await painel.getByRole('button', { name: 'Alterar', exact: true }).click()
  await janela
    .getByLabel('Data', { exact: true })
    .fill(calendario.format(Date.now() - dia))
  await salvar.click()
  await expect(janela).toHaveCount(0)
  await expect(retornos).toContainText('1')
  await page.getByRole('tab', { name: 'Retorno atrasado' }).click()
  await expect(
    page
      .getByRole('button', { name: new RegExp(marina) })
      .filter({ hasText: 'Atrasado' }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Funil', exact: true }).click()
  await expect(
    page.getByRole('article').filter({ hasText: marina }),
  ).toContainText('Atrasado')
  const outro = page.getByRole('article').filter({ hasText: 'Beatriz Lima' })
  await expect(outro).toBeVisible()
  await page.getByRole('button', { name: 'Retorno atrasado' }).click()
  await expect(outro).toHaveCount(0)
  await expect(
    page.getByRole('article').filter({ hasText: marina }),
  ).toBeVisible()
  await retornos.click()
  await expect(grupo('Atrasados')).toContainText(motivo)
  await capturas(page, 'retornos')
  const pessoa = page.getByRole('combobox', { name: 'Pessoa' })
  await pessoa.selectOption({ label: 'Caio Mendes' })
  await expect(linha).toHaveCount(0)
  await expect(grupo('Amanhã')).toContainText('Beatriz Lima')
  await pessoa.selectOption('')
  await linha.getByRole('button', { name: 'Feito', exact: true }).dblclick()
  await expect(retornos.locator('.badge')).toHaveCount(0)
  await linha.getByRole('button', { name: 'Desfazer' }).click()
  await expect(retornos).toContainText('1')
  await linha.getByRole('button', { name: 'Adiar' }).click()
  await page.getByRole('menuitem', { name: 'Amanhã, 9h' }).click()
  await expect(grupo('Amanhã')).toContainText(motivo)
  await expect(retornos.locator('.badge')).toHaveCount(0)
  await page.reload()
  await waitForHydration(pessoa)
  await expect(linha).toHaveCount(1)
  await expect(linha).toContainText('09:00')
  await linha.getByRole('button', { name: 'Feito', exact: true }).click()
  await expect(linha.getByRole('button', { name: 'Desfazer' })).toBeVisible()
})

test('J4 · H15, H20 · a nota do contato e a nota interna persistem uma vez depois de repetir', async ({
  page,
}) => {
  await abrir(page, conversa)
  const painel = page.getByRole('complementary', { name: 'Painel do contato' })
  const texto = 'Entrada de energia revisada na vistoria'
  const nota = painel.getByRole('textbox', { name: 'Nova nota' })
  await nota.fill(texto)
  await respostaPerdida(
    page,
    'vistoria',
    painel.getByRole('button', { name: 'Salvar nota', exact: true }),
    nota,
    texto,
  )
  await expect(painel.getByText(texto, { exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: 'Alternar nota interna' }).click()
  const equipe = page.getByRole('textbox', { name: 'Nota para a equipe' })
  const anotacao = 'A equipe já conferiu o telhado'
  await equipe.fill(anotacao)
  await respostaPerdida(
    page,
    'telhado',
    page.getByRole('button', { name: 'Salvar nota interna' }),
    equipe,
    anotacao,
  )
  await page.reload()
  await waitForHydration(painel)
  await expect(page.getByText(anotacao, { exact: true })).toHaveCount(1)
  await expect(painel.getByText(texto, { exact: true })).toHaveCount(1)
  await expect(painel).not.toContainText(anotacao)
  await capturas(page, 'notas', nota)
})

test('J5 · H14, H18, H43–44 · configura e usa a etiqueta e a resposta rápida', async ({
  page,
  browser,
  baseURL,
}) => {
  await abrir(page, '/app/configuracoes?secao=etiquetas')
  await page.getByRole('button', { name: 'Nova etiqueta' }).click()
  const janela = page.getByRole('dialog')
  const nome = janela.getByLabel('Nome', { exact: true })
  const salvar = janela.getByRole('button', { name: 'Salvar', exact: true })
  await nome.fill('Proposta J4')
  await janela.getByLabel('Cor', { exact: true }).fill('#7c3aed')
  await respostaPerdida(page, 'Proposta', salvar, nome, 'Proposta J4')
  await page.getByRole('button', { name: 'Renomear Proposta J4' }).click()
  await nome.fill('Visita técnica J4')
  await salvar.click()
  await expect(
    page.getByText('Visita técnica J4', { exact: true }),
  ).toHaveCount(1)
  await capturas(page, 'etiquetas')
  await abrir(page, '/app/configuracoes?secao=respostas')
  await page.getByRole('button', { name: 'Nova resposta' }).click()
  const mensagem = 'Qual horário funciona para a visita técnica?'
  const texto = janela.getByRole('textbox', { name: 'Texto', exact: true })
  await janela.getByLabel('Atalho', { exact: true }).fill('/visitaj4')
  await texto.fill(mensagem)
  await respostaPerdida(page, 'visitaj4', salvar, texto, mensagem)
  await expect(page.getByText('/visitaj4', { exact: true })).toHaveCount(1)
  await capturas(page, 'respostas')
  const vendedor = await browser.newPage({
    baseURL,
    storageState: { cookies: [], origins: [] },
  })
  try {
    await vendedor.goto('/login')
    await loginWithCode(vendedor, 'qa-j4-caio@exemplo.test')
    await expect(vendedor).toHaveURL(/\/app\/conversas$/)
    await abrir(vendedor, '/app/configuracoes?secao=respostas')
    await expect(
      vendedor.getByRole('heading', { name: 'Sem acesso' }),
    ).toBeVisible()
    await abrir(vendedor, conversa)
    const painel = vendedor.getByRole('complementary', {
      name: 'Painel do contato',
    })
    await painel.getByRole('button', { name: 'Adicionar etiqueta' }).click()
    await vendedor.getByRole('menuitem', { name: 'Visita técnica J4' }).click()
    await expect(
      painel.getByText('Visita técnica J4', { exact: true }),
    ).toBeVisible()
    const campo = vendedor.getByRole('textbox', {
      name: 'Mensagem',
      exact: true,
    })
    await campo.fill('/visita')
    await vendedor.getByRole('button', { name: /\/visitaj4/ }).click()
    await expect(campo).toHaveValue(mensagem)
    await vendedor.getByRole('link', { name: 'Contatos', exact: true }).click()
    await waitForHydration(
      vendedor.getByRole('heading', { name: 'Contatos', exact: true }),
    )
    const filtro = vendedor.getByRole('combobox', {
      name: 'Etiqueta',
      exact: true,
    })
    await waitForHydration(filtro)
    await filtro.selectOption({ label: 'Visita técnica J4' })
    await expect(vendedor.getByRole('table').getByRole('link')).toHaveText([
      marina,
    ])
    await abrir(vendedor, conversa)
    await painel
      .getByRole('button', { name: 'Remover etiqueta Visita técnica J4' })
      .click()
    await expect(
      painel.getByText('Visita técnica J4', { exact: true }),
    ).toHaveCount(0)
  } finally {
    await vendedor.close()
  }
  await abrir(page, '/app/configuracoes?secao=etiquetas')
  await page.getByRole('button', { name: 'Apagar Visita técnica J4' }).click()
  await janela.getByRole('button', { name: 'Apagar', exact: true }).click()
  await expect(
    page.getByText('Visita técnica J4', { exact: true }),
  ).toHaveCount(0)
  await abrir(page, '/app/configuracoes?secao=respostas')
  await page.getByRole('button', { name: 'Editar /visitaj4' }).click()
  await janela.getByRole('button', { name: 'Apagar resposta' }).click()
  await janela.getByRole('button', { name: 'Apagar', exact: true }).click()
  await expect(page.getByText('/visitaj4', { exact: true })).toHaveCount(0)
})

test('J4 · H33 · mostra o carregamento da agenda e permite repetir uma leitura interrompida', async ({
  page,
}) => {
  await abrir(page, '/app/contatos')
  const retornos = page.getByRole('link', { name: 'Retornos', exact: true })
  await waitForHydration(retornos)
  let falhar = true
  let liberar!: () => void
  const suspensa = new Promise<void>((resolve) => {
    liberar = resolve
  })
  await page.route('**/_serverFn/**', async (rota) => {
    const resposta = await rota.fetch()
    if (falhar && (await resposta.text()).includes('Confirmar a visita')) {
      await suspensa
      return rota.abort('connectionreset')
    }
    return rota.fulfill({ response: resposta })
  })
  try {
    await retornos.click()
    await expect(
      page.getByRole('status', { name: 'Carregando dados' }),
    ).toBeVisible()
    liberar()
    const alerta = page
      .getByRole('alert')
      .filter({ hasText: 'Não foi possível carregar' })
    await expect(alerta).toBeVisible({ timeout: 20_000 })
    falhar = false
    await alerta.getByRole('button', { name: 'Tentar de novo' }).click()
    await expect(page.locator('.agenda')).toContainText(
      'Confirmar a visita técnica',
    )
  } finally {
    liberar()
    await page.unrouteAll({ behavior: 'wait' })
  }
})
