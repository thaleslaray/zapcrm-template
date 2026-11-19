import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from '@playwright/test'
import { executarSqlE2E, loginWithCode, waitForHydration } from './helpers'
import { controle, mensagem } from './whatsapp-suporte'

test.use({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  permissions: ['microphone'],
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  },
})

const numero = 'Vendas J6'
const email = 'qa-vendedor-j6@exemplo.test'

async function abrirConversa(
  page: Page,
  request: APIRequestContext,
  telefone: string,
) {
  const contato = 'Carolina Ribeiro'
  const recebida = mensagem(
    'CONTATO-J6',
    contato,
    telefone,
    'Pode me enviar a foto do telhado e a proposta?',
  )
  await controle(request, 'preparar', numero, { mensagens: [recebida] })
  await page.goto('/app/configuracoes?secao=numeros')
  const conectar = page.getByRole('button', {
    name: 'Conectar número',
    exact: true,
  })
  await waitForHydration(conectar)
  await conectar.click()
  await page.getByRole('checkbox', { name: numero, exact: true }).check()
  await page
    .getByLabel(`Setor de ${numero}`, { exact: true })
    .selectOption({ label: 'Comercial' })
  await page
    .getByLabel(`Funil padrão de ${numero}`, { exact: true })
    .selectOption('vendas')
  await page.getByRole('button', { name: 'Adicionar selecionados' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goto('/app/conversas')
  const linha = page.getByRole('button', { name: new RegExp(contato) })
  await waitForHydration(linha)
  await linha.click()
  await expect(page.getByRole('log').getByText(recebida.text)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Anexar', exact: true }),
  ).toBeEnabled()
}

test.afterEach(async ({ request }) => {
  executarSqlE2E(`
    DELETE FROM contatos WHERE id IN (SELECT c.contato_id FROM conversas c JOIN numeros n ON n.id=c.numero_id WHERE n.nome='${numero}');
    DELETE FROM numeros WHERE nome='${numero}';
    DELETE FROM user WHERE email='${email}';
  `)
  await controle(request, 'remover', numero)
})

async function escolher(
  page: Page,
  tipo: 'Foto' | 'Documento',
  arquivo: { name: string; mimeType: string; buffer: Buffer },
) {
  await page.getByRole('button', { name: 'Anexar', exact: true }).click()
  const [escolha] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByText(tipo, { exact: true }).click(),
  ])
  await escolha.setFiles(arquivo)
}

async function capturar(page: Page, nome: string) {
  const pasta = process.env.ZAPCRM_CAPTURAS_06
  if (!pasta) return
  await mkdir(pasta, { recursive: true })
  await page.screenshot({
    path: path.join(pasta, `${nome}.png`),
    animations: 'disabled',
  })
}

test('J6 · H10, H11 · foto, documento e áudio persistem depois de recarregar', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(150_000)
  await abrirConversa(page, request, '5511987658961')
  const chat = page.getByRole('log', { name: 'Mensagens' })
  const foto = await readFile('e2e/uazapi/telhado.png')
  const pdf = await readFile('e2e/uazapi/proposta.pdf')
  const legenda = 'Vista do telhado da padaria'
  const nomeDoc = 'Proposta de instalação.pdf'
  await escolher(page, 'Foto', {
    name: 'telhado.png',
    mimeType: 'image/png',
    buffer: foto,
  })
  await expect(page.getByAltText('Prévia da foto')).toBeVisible()
  const campo = page.getByRole('textbox', { name: 'Legenda' })
  await campo.fill(legenda)
  await capturar(page, 'previa-foto-1440-claro')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(
    page.getByRole('button', { name: 'Enviar foto' }),
  ).toBeInViewport()
  await capturar(page, 'previa-foto-390-claro')
  await page.setViewportSize({ width: 1440, height: 900 })
  const uploads: string[] = []
  page.on('request', (req) => {
    const nome = req.headers()['x-arquivo-nome']
    if (
      req.url().includes('/api/whatsapp/envio/') &&
      req.method() === 'POST' &&
      nome
    )
      uploads.push(decodeURIComponent(nome))
  })
  // O servidor gravou e o navegador perdeu a resposta. Reconciliar o id conserva a legenda e os bytes.
  let perdeu = false
  await page.route(
    '**/api/whatsapp/envio/**',
    async (rota) => {
      expect((await rota.fetch()).ok()).toBe(true)
      perdeu = true
      await rota.abort('connectionreset')
    },
    { times: 1 },
  )
  await page.getByRole('button', { name: 'Enviar foto' }).dblclick()
  await expect.poll(() => perdeu).toBe(true)
  await expect(campo).toHaveValue(legenda)
  await page.getByRole('button', { name: 'Tentar de novo' }).click()
  await expect(campo).toHaveCount(0)
  const img = chat.getByAltText(legenda)
  await expect(img).toBeVisible()
  expect(uploads).toEqual(['telhado.png'])
  await escolher(page, 'Documento', {
    name: nomeDoc,
    mimeType: 'application/pdf',
    buffer: pdf,
  })
  await expect(page.getByText(nomeDoc, { exact: true })).toBeVisible()
  await expect(page.getByText(/9[,.]2\s*(?:KiB|KB)/i)).toBeVisible()
  // Nenhum byte chegou. Só depois da reconciliação negativa é preciso repetir a subida.
  await page.route(
    '**/api/whatsapp/envio/**',
    (rota) => rota.abort('connectionreset'),
    { times: 1 },
  )
  await page.getByRole('button', { name: 'Enviar documento' }).dblclick()
  await expect(
    page.getByRole('alert').filter({ hasText: /anexo foi mantido/i }),
  ).toBeVisible()
  await expect(page.getByText(nomeDoc, { exact: true })).toBeVisible()
  await expect(chat.getByText(nomeDoc, { exact: true })).toHaveCount(0)
  await controle(request, 'falhar-envio', numero)
  await page.getByRole('button', { name: 'Tentar de novo' }).click()
  await expect(chat.getByText(/Não enviada/)).toBeVisible()
  const uploadsAntes = [...uploads]
  expect(uploadsAntes).toEqual(['telhado.png', nomeDoc, nomeDoc])
  await chat.getByRole('button', { name: 'Tentar de novo' }).dblclick()
  await expect(chat.getByText(/Não enviada/)).toHaveCount(0)
  expect(uploads).toEqual(uploadsAntes)
  const gravar = page.getByRole('button', { name: 'Gravar áudio' })
  await gravar.click()
  await expect(page.getByRole('timer')).toContainText(/0:0[1-9]/)
  await page.getByRole('button', { name: 'Cancelar gravação' }).click()
  await expect(gravar).toBeVisible()
  await expect(chat.locator('audio')).toHaveCount(0)
  await gravar.click()
  await expect(page.getByRole('timer')).toContainText(/0:0[1-9]/)
  await capturar(page, 'gravacao-1440-claro')
  await page.getByRole('button', { name: 'Enviar áudio' }).click()
  await expect(chat.getByRole('button', { name: 'Tocar áudio' })).toBeVisible()
  await page.reload()
  await waitForHydration(gravar)
  await expect(chat.getByText(legenda, { exact: true })).toHaveCount(1)
  const doc = chat.getByRole('link', { name: `Baixar ${nomeDoc}` })
  await expect(doc).toHaveCount(1)
  const privado = await img.getAttribute('src')
  const arquivoDoc = await doc.getAttribute('href')
  if (!privado || !arquivoDoc)
    throw new Error('Foto ou documento sem endereço privado.')
  expect(await (await page.request.get(privado)).body()).toEqual(foto)
  expect(await (await page.request.get(arquivoDoc)).body()).toEqual(pdf)
  await expect(chat.locator('audio')).toHaveCount(1)
  await chat.getByRole('button', { name: 'Tocar áudio' }).click()
  await expect
    .poll(() =>
      chat
        .locator('audio')
        .evaluate((el) => (el as HTMLAudioElement).currentTime),
    )
    .toBeGreaterThan(0)
  const enderecoAudio = await chat.locator('audio').getAttribute('src')
  if (!enderecoAudio) throw new Error('Áudio sem endereço privado.')
  const bytesAudio = await (await page.request.get(enderecoAudio)).body()
  const hash = (conteudo: Buffer) =>
    createHash('sha256').update(conteudo).digest('hex')
  const provedor = await controle(request, 'inspecionar', numero)
  expect(provedor.midias).toHaveLength(3)
  expect(provedor.midias).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        tipo: 'image',
        mime: 'image/png',
        sha256: hash(foto),
      }),
      expect.objectContaining({
        tipo: 'document',
        mime: 'application/pdf',
        nome: nomeDoc,
        sha256: hash(pdf),
      }),
      expect.objectContaining({
        tipo: 'ptt',
        mime: 'audio/ogg',
        sha256: hash(bytesAudio),
      }),
    ]),
  )
  await capturar(page, 'conversa-1440-claro')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(gravar).toBeInViewport()
  await capturar(page, 'conversa-390-claro')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: 'Mudar para o modo escuro' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await capturar(page, 'conversa-1440-escuro')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(gravar).toBeInViewport()
  await capturar(page, 'conversa-390-escuro')

  const conversa = new URL(page.url()).searchParams.get('conversa')
  expect(conversa).toBeTruthy()
  const envio = `/api/whatsapp/envio/${conversa}/${randomUUID()}`
  const headers = {
    'x-arquivo-nome': 'telhado.png',
    'content-type': 'image/png',
  }
  const isolado = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    storageState: { cookies: [], origins: [] },
  })
  try {
    expect(privado).toMatch(/^\/api\/whatsapp\/midia\//)
    expect(await isolado.cookies()).toHaveLength(0)
    expect((await isolado.request.get(privado)).status()).toBe(401)
    expect(
      (await isolado.request.post(envio, { headers, data: foto })).status(),
    ).toBe(401)
    const outra = await isolado.newPage()
    await outra.goto('/login')
    await loginWithCode(outra, email)
    await expect(outra).toHaveURL(/app\/conversas/)
    executarSqlE2E(
      `INSERT OR IGNORE INTO pessoas_setores (usuario_id,setor_id) SELECT id,'pos' FROM user WHERE email='${email}'`,
    )
    expect([403, 404]).toContain((await outra.request.get(privado)).status())
    expect([403, 404]).toContain(
      (await outra.request.post(envio, { headers, data: foto })).status(),
    )
    const id = privado.split('/').pop()
    expect([403, 404]).toContain(
      (
        await outra.request.post(`/api/whatsapp/envio/${conversa}/${id}`)
      ).status(),
    )
    await outra.goto(page.url())
    await expect(outra.getByText(/Sem acesso/i).first()).toBeVisible()
  } finally {
    await isolado.close()
  }
  expect(
    (
      await page.request.post(envio, {
        headers: { ...headers, origin: 'https://outro.exemplo' },
        data: foto,
      })
    ).status(),
  ).toBe(403)
  await page.getByRole('button', { name: 'Abrir painel do contato' }).click()
  await page.getByRole('button', { name: 'Apagar contato' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Apagar contato' })
    .click()
  await expect(page).toHaveURL(/\/app\/contatos/)
  expect((await page.request.get(privado)).status()).toBe(404)
})

test('J6 · H10, H11 · recusar tipo e tamanho com uma mensagem clara', async ({
  page,
  request,
}) => {
  await abrirConversa(page, request, '5511987658962')
  const grande = Buffer.alloc(4 * 1024 * 1024 + 1)
  grande.set([0xff, 0xd8, 0xff])
  for (const [buffer, erro] of [
    [Buffer.from('arquivo incompatível'), /formato|tipo/i],
    [grande, /4 MiB/i],
  ] as const) {
    await escolher(page, 'Foto', {
      name: 'telhado.jpg',
      mimeType: 'image/jpeg',
      buffer,
    })
    await page.getByRole('button', { name: 'Enviar foto' }).click()
    await expect(
      page.getByRole('alert').filter({ hasText: erro }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Cancelar anexo' }).click()
  }
  expect((await controle(request, 'inspecionar', numero)).midias).toEqual([])
})

test('avisa antes de enviar a gravação MP4/AAC como documento', async ({
  page,
  request,
}) => {
  const podeGravarAac = await page.evaluate(() =>
    MediaRecorder.isTypeSupported('audio/mp4;codecs=mp4a.40.2'),
  )
  test.skip(
    !podeGravarAac,
    'O navegador deste ambiente não dispõe do gravador AAC.',
  )
  await page.addInitScript(() => {
    const suporta = MediaRecorder.isTypeSupported.bind(MediaRecorder)
    MediaRecorder.isTypeSupported = (mime) =>
      mime.startsWith('audio/mp4') && suporta(mime)
  })
  await abrirConversa(page, request, '5511987658963')
  await page.getByRole('button', { name: 'Gravar áudio' }).click()
  await expect(
    page.getByText(/o áudio será enviado como documento/i),
  ).toBeVisible()
  await expect(page.getByRole('timer')).toContainText(/0:0[1-9]/)
  await page.getByRole('button', { name: 'Enviar áudio' }).click()
  await expect
    .poll(async () => (await controle(request, 'inspecionar', numero)).midias)
    .toEqual([expect.objectContaining({ tipo: 'document', mime: 'audio/mp4' })])
})
