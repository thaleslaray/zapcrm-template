import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { expect, type Page, test } from '@playwright/test'
import {
  bancoE2E,
  executarSqlE2E,
  loginWithCode,
  waitForHydration,
} from './helpers'
import {
  capturar,
  controle,
  emitir,
  mensagem,
  segredosLocais,
} from './whatsapp-suporte'

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

async function abrirCadastro(page: Page) {
  await page.goto('/app/configuracoes?secao=numeros')
  const conectar = page.getByRole('button', {
    name: 'Conectar número',
    exact: true,
  })
  await waitForHydration(conectar)
  await conectar.click()
}
async function criar(page: Page, nome: string, dias: string) {
  await abrirCadastro(page)
  await page.getByRole('button', { name: 'Criar número novo' }).click()
  await page.getByLabel('Nome do número', { exact: true }).fill(nome)
  await page
    .getByLabel('Setor', { exact: true })
    .selectOption({ label: 'Comercial' })
  await page.getByLabel('Funil padrão', { exact: true }).selectOption('vendas')
  const historico = page.getByLabel('Dias de histórico', { exact: true })
  const criarNumero = page.getByRole('button', { name: 'Criar e conectar' })
  await historico.fill('0')
  await expect(criarNumero).toBeDisabled()
  await historico.fill(dias)
  await criarNumero.dblclick()
  await expect(page.getByAltText('QR Code de conexão')).toBeVisible()
}
test('J3 · H1–13, H37–40 · receber, responder, repetir após falha e reconectar', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(160_000)
  const nome = 'Comercial Solar'
  const cliente = 'Marina Prado'
  const telefone = '5511984213307'
  const primeiro = mensagem(
    'PRIMEIRA',
    cliente,
    telefone,
    'Gostaria de uma proposta para a padaria.',
  )
  const cargas: Promise<string>[] = []
  page.on('response', (res) => {
    if (
      res.request().resourceType() === 'document' ||
      res.url().includes('/_serverFn/')
    )
      cargas.push(res.text().catch(() => ''))
  })
  await page.goto('/app/conversas')
  await expect(
    page.getByRole('heading', {
      name: 'Conecte um número do WhatsApp para começar',
    }),
  ).toBeVisible()
  await capturar(page, 'vazio-1440-claro')
  await criar(page, nome, '90')
  await capturar(page, 'pareamento-1440-claro')
  const remoto = await controle(request, 'inspecionar', nome)
  expect(remoto.chamadas.indexOf('/webhook')).toBeLessThan(
    remoto.chamadas.indexOf('/instance/connect'),
  )
  const aviso = (evento: Record<string, unknown>) =>
    emitir(request, nome, evento)
  await aviso({ EventType: 'connection', instance: { status: 'connected' } })
  await aviso({
    EventType: 'history',
    event: 'status',
    batchHistoryStatus: 'complete',
    batchChunkOrder: 1,
  })
  await page.goto('/app/conversas')
  await aviso({ EventType: 'messages', message: primeiro })
  await aviso({ EventType: 'messages', message: primeiro })
  const linha = page.locator('button.row').filter({ hasText: cliente })
  await expect(linha).toContainText('Novo')
  await expect(linha).toContainText(nome)
  await linha.click()
  const chat = page.getByRole('log', { name: 'Mensagens' })
  await expect(chat.getByText(primeiro.text)).toHaveCount(1)
  await expect(linha.locator('.badge')).toHaveCount(0)
  const campo = page.getByRole('textbox', { name: 'Mensagem', exact: true })
  const enviar = page.getByRole('button', {
    name: 'Enviar mensagem',
    exact: true,
  })
  const resposta = 'Posso agendar a visita na quinta.'
  await campo.fill(resposta)
  await enviar.dblclick()
  await expect(
    chat.getByRole('img', { name: 'Enviada', exact: true }),
  ).toBeVisible()
  const saidas = (
    await controle(request, 'inspecionar', nome)
  ).mensagens.filter((m: { fromMe: boolean }) => m.fromMe)
  expect(saidas).toHaveLength(1)
  const recibo = (state: string) =>
    aviso({
      EventType: 'messages_update',
      state,
      type: 'ReadReceipt',
      event: {
        Type: state,
        IsFromMe: true,
        IsGroup: false,
        chatid: primeiro.chatid,
        MessageIDs: [saidas[0].messageid],
        Timestamp: Math.floor(Date.now() / 1000),
      },
    })
  await recibo('Delivered')
  await expect(
    chat.getByRole('img', { name: 'Entregue', exact: true }),
  ).toBeVisible()
  await recibo('Read')
  await recibo('Sent')
  await expect(
    chat.getByRole('img', { name: 'Lida', exact: true }),
  ).toBeVisible()
  const retry = 'Esta mensagem sobrevive à falha.'
  await controle(request, 'falhar-envio', nome)
  await campo.fill(retry)
  await enviar.click()
  await expect(chat.getByText('Não enviada', { exact: false })).toBeVisible()
  await chat.getByRole('button', { name: 'Tentar de novo' }).dblclick()
  await expect(chat.getByText('Não enviada', { exact: false })).toHaveCount(0)
  await expect(chat.getByText(retry, { exact: true })).toHaveCount(1)
  // Perda da resposta após gravação. O transporte aceita track_id repetido.
  const perdido = 'O pedido chegou mesmo sem resposta no navegador.'
  let perdeuResposta = false
  await page.route('**/_serverFn/**', async (route) => {
    if (!route.request().postData()?.includes(perdido)) return route.continue()
    await route.fetch()
    perdeuResposta = true
    await route.abort('connectionreset')
  })
  await campo.fill(perdido)
  await enviar.click()
  await expect
    .poll(
      async () =>
        (await controle(request, 'inspecionar', nome)).mensagens.filter(
          (m: { text: string }) => m.text === perdido,
        ).length,
    )
    .toBe(1)
  await expect.poll(() => perdeuResposta).toBe(true)
  await page.unroute('**/_serverFn/**')
  await expect(campo).toHaveValue(perdido)
  await enviar.click()
  await expect(campo).toHaveValue('')
  await page.reload()
  await expect(chat.getByText(perdido, { exact: true })).toHaveCount(1)
  for (const [id, tipo, texto, mime, arquivo] of [
    ['FOTO', 'ImageMessage', 'Telhado da padaria', 'image/png', 'telhado.png'],
    ['PDF', 'DocumentMessage', '', 'application/pdf', 'Proposta Solar.pdf'],
    ['AUDIO', 'AudioMessage', '', 'audio/mpeg', 'recado.mp3'],
  ]) {
    await aviso({
      EventType: 'messages',
      message: mensagem(id, cliente, telefone, texto, {
        messageType: tipo,
        content: {
          caption: texto,
          fileName: arquivo,
          mimetype: mime,
          seconds: 1,
        },
      }),
    })
  }
  const foto = chat.locator('img[src*="/api/whatsapp/midia/"]')
  await expect(foto).toBeVisible()
  await expect
    .poll(() => foto.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBe(400)
  const doc = chat.getByRole('link', { name: /Proposta Solar.pdf/ })
  await expect(doc).toBeVisible()
  const enderecoDoc = await doc.getAttribute('href')
  if (!enderecoDoc) throw new Error('O documento ficou sem endereço.')
  const documento = await page.request.get(enderecoDoc)
  expect((await documento.body()).subarray(0, 5).toString()).toBe('%PDF-')
  const audio = chat.locator('audio')
  await expect
    .poll(() => audio.evaluate((el) => (el as HTMLAudioElement).readyState))
    .toBeGreaterThan(0)
  const midia = await foto.getAttribute('src')
  if (!midia) throw new Error('A foto ficou sem endereço.')
  await chat.getByRole('button', { name: 'Tocar áudio' }).click()
  await expect
    .poll(() => audio.evaluate((el) => (el as HTMLAudioElement).currentTime))
    .toBeGreaterThan(0)
  await capturar(page, 'conversa-1440-claro')
  await page.getByRole('button', { name: 'Mudar para o modo escuro' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await capturar(page, 'conversa-1440-escuro')
  await page.getByRole('button', { name: 'Mudar para o modo claro' }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await capturar(page, 'conversa-390-claro')
  const urlChat = page.url()
  await page.getByRole('button', { name: 'Voltar', exact: true }).click()
  const buscar = page.getByRole('searchbox', { name: 'Buscar conversa' })
  await buscar.fill('Marina')
  await expect(linha).toBeVisible()
  await capturar(page, 'lista-390-claro')
  await page.getByRole('tab', { name: 'Minhas' }).click()
  await expect(linha).toHaveCount(0)
  await page.getByRole('tab', { name: 'Todas' }).click()
  await linha.click()
  await page.getByRole('button', { name: 'Voltar', exact: true }).click()
  await expect(buscar).toHaveValue('Marina')
  await buscar.fill('nenhum contato com este nome')
  await expect(page.getByText(/Nada encontrado/)).toBeVisible()
  await page.getByRole('button', { name: 'Limpar busca' }).click()
  await page.setViewportSize({ width: 1440, height: 900 })
  await aviso({ EventType: 'connection', instance: { status: 'disconnected' } })
  const alerta = page.getByRole('alert').filter({ hasText: nome })
  await expect(alerta).toContainText('desconectado')
  await capturar(page, 'queda-1440-claro')
  await alerta.getByText('Reconectar').click()
  await page.getByRole('button', { name: 'Gerar QR Code' }).click()
  await expect(page.getByAltText('QR Code de conexão')).toBeVisible()
  await aviso({ EventType: 'connection', instance: { status: 'connected' } })
  await page.goto('/app/conversas')
  await expect(
    page.getByRole('alert').filter({ hasText: 'desconectado' }),
  ).toHaveCount(0)
  await page.goto('/app/configuracoes?secao=numeros')
  const cartao = page.locator('.numcard').filter({ hasText: nome })
  const desconectar = cartao.getByRole('button', {
    name: 'Desconectar',
    exact: true,
  })
  await waitForHydration(desconectar)
  await desconectar.click()
  await expect(cartao).toContainText('Desconectado')
  const local = await segredosLocais()
  const visivel = (await Promise.all(cargas)).join('\n')
  const logLocal = await readFile('e2e/.dev.log', 'utf8')
  for (const segredo of [
    remoto.dados.token,
    new URL(remoto.avisos.url).pathname.split('/').pop(),
    local.UAZAPI_URL,
    local.UAZAPI_ADMIN_TOKEN,
    local.UAZAPI_CHAVE,
  ])
    expect(visivel.includes(segredo) || logLocal.includes(segredo)).toBe(false)

  // O cadastro da equipe pertence ao ticket 05. A segunda sessão é real.
  const vendedor = await browser.newContext({
    baseURL: new URL(urlChat).origin,
    storageState: { cookies: [], origins: [] },
  })
  try {
    const outra = await vendedor.newPage()
    await outra.goto('/login')
    await loginWithCode(outra, 'qa-vendedor-03@exemplo.test')
    await expect(outra).toHaveURL(/app\/conversas/)
    execFileSync('npx', [
      '--no-install',
      'wrangler',
      'd1',
      'execute',
      'DB',
      '--local',
      '--persist-to',
      bancoE2E,
      '--command',
      "INSERT OR IGNORE INTO pessoas_setores (usuario_id,setor_id) SELECT id,'pos' FROM user WHERE email='qa-vendedor-03@exemplo.test'",
    ])
    await outra.goto('/app/conversas')
    await expect(outra.getByText(cliente, { exact: true })).toHaveCount(0)
    await outra.goto(urlChat)
    await expect(outra.getByText(/Sem acesso/i).first()).toBeVisible()
    expect([403, 404]).toContain((await outra.request.get(midia)).status())
  } finally {
    await vendedor.close()
  }
})

test('J8 · H37–39 · histórico repetido chega em ordem, sem negócios nem não lidas', async ({
  page,
  request,
}) => {
  const nome = 'Histórico Solar'
  await criar(page, nome, '180')
  expect((await controle(request, 'inspecionar', nome)).dias).toBe(180)
  await page.setViewportSize({ width: 390, height: 844 })
  await page
    .getByRole('tab', { name: 'Conectar com número de telefone' })
    .click()
  await page
    .getByLabel('Número do WhatsApp', { exact: true })
    .fill('5511998877665')
  await page.getByRole('button', { name: 'Gerar código' }).click()
  await expect(page.getByLabel('Código de pareamento 12345678')).toBeVisible()
  await capturar(page, 'pareamento-telefone-390-claro')
  await page.setViewportSize({ width: 1440, height: 900 })
  await emitir(request, nome, {
    EventType: 'connection',
    instance: { status: 'connected' },
  })
  await page.goto('/app/conversas')
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: `Sincronizando histórico · ${nome}` }),
  ).toBeVisible()
  const cliente = 'Sebastião Rocha'
  const ontem = Date.now() - 86400_000
  const antes = mensagem(
    'ANTIGA-A',
    cliente,
    '5511992233556',
    'Primeira visita',
    { messageTimestamp: ontem },
  )
  const depois = mensagem(
    'ANTIGA-B',
    cliente,
    '5511992233556',
    'Orçamento recebido',
  )
  const lote = {
    EventType: 'history',
    event: 'messages',
    batchHistoryStatus: 'loading',
    batchNumber: 1,
    batchTotal: 1,
    batchChunkOrder: 2,
    messages: [depois, antes],
  }
  await emitir(request, nome, lote)
  await emitir(request, nome, lote)
  const linha = page.locator('button.row').filter({ hasText: cliente })
  await expect(linha).toContainText('Orçamento recebido')
  await expect(linha.locator('.badge')).toHaveCount(0)
  await expect(linha).not.toContainText('Novo')
  await emitir(request, nome, {
    EventType: 'history',
    event: 'status',
    batchHistoryStatus: 'complete',
    batchChunkOrder: 2,
  })
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: `Sincronizando histórico · ${nome}` }),
  ).toHaveCount(0)
  await linha.click()
  const log = page.getByRole('log', { name: 'Mensagens' })
  await expect(log.getByText(/Primeira visita|Orçamento recebido/)).toHaveText([
    'Primeira visita',
    'Orçamento recebido',
  ])
  await expect(log.getByText('Ontem', { exact: true })).toBeVisible()
  await expect(log.getByText('Hoje', { exact: true })).toBeVisible()
})

test('J3 · H36a · adicionar duas instâncias conectadas e ler o histórico retido', async ({
  page,
  request,
}) => {
  const nome = 'Suporte Solar'
  const segundo = 'Instalação Solar'
  const msg = mensagem(
    'GUARDADA',
    'Juliana Teles',
    '5511985510219',
    'Solicitação de instalação',
  )
  await controle(request, 'preparar', nome, { mensagens: [msg] })
  await controle(request, 'preparar', segundo)
  await abrirCadastro(page)
  for (const n of [nome, segundo]) {
    await page.getByRole('checkbox', { name: n, exact: true }).check()
    await page.getByLabel(`Setor de ${n}`, { exact: true }).selectOption('pos')
    await page
      .getByLabel(`Funil padrão de ${n}`, { exact: true })
      .selectOption('pos')
  }
  await page.getByRole('button', { name: 'Adicionar selecionados' }).dblclick()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await capturar(page, 'numeros-1440-claro')
  await abrirCadastro(page)
  await expect(
    page.getByRole('checkbox', { name: nome, exact: true }),
  ).toBeDisabled()
  expect((await controle(request, 'inspecionar', nome)).chamadas).not.toContain(
    '/instance/connect',
  )
  await page.goto('/app/conversas')
  const linha = page.locator('button.row').filter({ hasText: 'Juliana Teles' })
  await expect(linha).toContainText(msg.text)
  await expect(linha.locator('.badge')).toHaveCount(0)
  await expect(linha).not.toContainText('Instalação agendada')
  const filtro = page.getByRole('combobox', { name: 'Número da empresa' })
  await waitForHydration(filtro)
  await filtro.selectOption({ label: segundo })
  await expect(linha).toHaveCount(0)
  await filtro.selectOption({ label: nome })
  await expect(linha).toBeVisible()
})

test('J3 e J2 · mensagem recebida abre o negócio do contato no painel', async ({
  page,
  request,
}) => {
  const numero = 'Consultoria Solar'
  const contato = 'Lívia Duarte'
  try {
    await criar(page, numero, '1')
    await emitir(request, numero, {
      EventType: 'connection',
      instance: { status: 'connected' },
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/app/conversas')
    const recebida = mensagem(
      'CONSULTORIA-1',
      contato,
      '5511972851604',
      'Quero um orçamento de energia solar.',
    )
    await emitir(request, numero, { EventType: 'messages', message: recebida })
    const linha = page.getByRole('button', { name: new RegExp(contato) })
    await waitForHydration(linha)
    await linha.click()
    await expect(page.getByRole('log').getByText(recebida.text)).toBeVisible()
    await page.getByRole('button', { name: 'Abrir painel do contato' }).click()
    const painel = page.getByRole('complementary', {
      name: 'Painel do contato',
    })
    await expect(painel.getByRole('heading', { name: contato })).toBeVisible()
    await expect(painel.getByText('Vendas', { exact: true })).toBeVisible()
    await expect(painel.getByText(/^Aberto em /)).toBeVisible()
    await expect(
      painel.getByRole('button', { name: 'Mover para Novo' }),
    ).toBeDisabled()
    await expect(
      painel.getByRole('button', { name: 'Mover para Proposta' }),
    ).toBeEnabled()
  } finally {
    executarSqlE2E(
      "DELETE FROM contatos WHERE telefone='5511972851604'; DELETE FROM numeros WHERE nome='Consultoria Solar'",
    )
    await controle(request, 'remover', numero)
  }
})

test('o gestor vê o limite da criação e o prazo da conexão no formulário', async ({
  page,
  request,
}) => {
  const nome = 'Pareamento com limite'
  await controle(request, 'limitar-pareamento', nome)
  await abrirCadastro(page)
  await page.getByRole('button', { name: 'Criar número novo' }).click()
  await page.getByLabel('Nome do número', { exact: true }).fill(nome)
  const salvar = page.getByRole('button', { name: 'Criar e conectar' })
  await salvar.click()
  await expect(page.getByRole('alert')).toHaveText(
    'O servidor atingiu o limite de instâncias.',
  )
  await salvar.click()
  await expect(page.getByRole('alert')).toHaveText(
    'O servidor uazapi recusou a conexão: o limite de números conectados do plano foi atingido. Confira o plano no painel da uazapi. Tente novamente em 17 segundos.',
  )
})
