import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import {
  type APIRequestContext,
  type Browser,
  expect,
  type Page,
  test,
} from '@playwright/test'
import { executarSqlE2E, loginWithCode, waitForHydration } from './helpers'
import { controle, emitir, mensagem } from './whatsapp-suporte'

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

const canal = '/api/tempo-real/'
const numero = 'Comercial J7'
const contato = 'Marina da Padaria'
const telefone = '5511984550717'

test('J7 · H1, H9, H40 · a tela abre a conexão do Comercial', async ({
  page,
}) => {
  const setores: string[] = []
  page.on('websocket', (socket) => setores.push(new URL(socket.url()).pathname))
  await page.goto('/app/conversas')
  await waitForHydration(page.getByRole('link', { name: 'Contatos' }).first())
  await expect.poll(() => setores).toContain('/api/tempo-real/com')
})

async function adicionarNumero(page: Page, request: APIRequestContext) {
  await controle(request, 'preparar', numero)
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
    .selectOption('com')
  await page
    .getByLabel(`Funil padrão de ${numero}`, { exact: true })
    .selectOption('vendas')
  await page.getByRole('button', { name: 'Adicionar selecionados' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
}

async function entrarNoSetor(
  browser: Browser,
  baseURL: string,
  setor: 'pos' | 'com',
) {
  const contexto = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  })
  const pagina = await contexto.newPage()
  const email = `qa-${setor}-j7@exemplo.test`
  await pagina.goto('/login')
  await loginWithCode(pagina, email)
  await expect(pagina).toHaveURL(/app\/conversas/)
  executarSqlE2E(
    `INSERT INTO pessoas_setores (usuario_id,setor_id) SELECT id,'${setor}' FROM user WHERE email='${email}'`,
  )
  return pagina
}

type RedeJ7 = {
  interromper: () => void
  liberar: () => void
  conectada: () => boolean
  tentativas: number[]
}

declare global {
  interface Window {
    redeJ7: RedeJ7
  }
}

// Mantém HTTP e o WebSocket do Vite funcionando. Na queda, a próxima tentativa
// recebe uma negativa real do Worker. Ao liberar, volta ao endereço original.
async function controlarQueda(page: Page) {
  await page.addInitScript((canal) => {
    let fora = false
    let socket: WebSocket | undefined
    const tentativas: number[] = []
    const WS = window.WebSocket
    window.WebSocket = new Proxy(WS, {
      construct(alvo, args) {
        const url = new URL(args[0], location.href)
        if (url.pathname !== `${canal}com`) return Reflect.construct(alvo, args)
        if (fora) {
          tentativas.push(performance.now())
          url.pathname = `${canal}pos`
          args[0] = url.toString()
        }
        socket = Reflect.construct(alvo, args) as WebSocket
        return socket
      },
    })
    window.redeJ7 = {
      interromper() {
        fora = true
        socket?.close()
      },
      liberar() {
        fora = false
      },
      conectada: () => socket?.readyState === WS.OPEN,
      tentativas,
    }
  }, canal)
}

function ouvirAvisos(page: Page, setor: string) {
  const avisos: (string | Buffer)[] = []
  page.on('websocket', (ws) => {
    if (new URL(ws.url()).pathname === canal + setor) {
      ws.on('framereceived', ({ payload }) => avisos.push(payload))
    }
  })
  return avisos
}

async function capturar(page: Page) {
  const pasta = process.env.ZAPCRM_CAPTURAS_07
  if (!pasta) return
  await mkdir(pasta, { recursive: true })
  for (const modo of ['claro', 'escuro']) {
    await page.setViewportSize({ width: 1440, height: 900 })
    if (modo === 'escuro') {
      await page
        .getByRole('button', { name: 'Mudar para o modo escuro' })
        .click()
      await expect(page.locator('html')).toHaveClass(/dark/)
    }
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height })
      await expect(
        page.getByRole('textbox', { name: 'Mensagem', exact: true }),
      ).toBeInViewport()
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width)
      await page.screenshot({
        path: path.join(pasta, `conversa-${width}-${modo}.png`),
        animations: 'disabled',
      })
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}

test('J7 · H1, H9, H40 · duas pessoas recebem mudanças, o outro setor fica isolado e a queda se recupera', async ({
  page: gestora,
  browser,
  request,
  baseURL,
}) => {
  test.setTimeout(150_000)
  const origem = new URL(baseURL ?? gestora.url()).origin
  await adicionarNumero(gestora, request)
  const comercial = await entrarNoSetor(browser, origem, 'com')
  const pos = await entrarNoSetor(browser, origem, 'pos')
  const telas = [gestora, comercial]
  const chat = (page: Page) => page.getByRole('log', { name: 'Mensagens' })
  const linha = (page: Page) =>
    page.locator('button.row').filter({ hasText: contato })
  const alerta = (page: Page) =>
    page.getByRole('alert').filter({ hasText: numero })
  const recebido = (id: string, texto: string) => ({
    EventType: 'messages',
    message: mensagem(id, contato, telefone, texto),
  })
  try {
    await controlarQueda(comercial)
    const avisosGestora = ouvirAvisos(gestora, 'com')
    const avisosComercial = ouvirAvisos(comercial, 'com')
    const avisosPos = ouvirAvisos(pos, 'pos')
    for (const page of [...telas, pos]) {
      await page.goto('/app/conversas')
      await waitForHydration(
        page.getByRole('link', { name: 'Contatos' }).first(),
      )
    }
    await expect
      .poll(() => comercial.evaluate(() => window.redeJ7.conectada()))
      .toBe(true)
    const tentarConectar = (setor: string) =>
      pos.evaluate(
        (caminho) =>
          new Promise<boolean>((resolve) => {
            const ws = new WebSocket(caminho)
            ws.onopen = () => {
              ws.close()
              resolve(true)
            }
            ws.onerror = () => resolve(false)
          }),
        canal + setor,
      )
    expect(await tentarConectar('pos')).toBe(true)
    expect(await tentarConectar('com')).toBe(false)

    const primeiro = recebido(
      'J7-1',
      'Vocês conseguem visitar a padaria na quinta?',
    )
    await emitir(request, numero, primeiro)
    await emitir(request, numero, primeiro)
    for (const page of telas) {
      await expect(linha(page)).toContainText(primeiro.message.text)
      await linha(page).click()
      await expect(
        chat(page).getByText(primeiro.message.text, { exact: true }),
      ).toHaveCount(1)
    }
    await expect(linha(pos)).toHaveCount(0)

    // Sem eco do provedor, só o envio da equipe pode acordar a segunda tela.
    await controle(request, 'pausar-eco', numero)
    const texto = 'Sim, reservamos a manhã de quinta para a visita.'
    await gestora
      .getByRole('textbox', { name: 'Mensagem', exact: true })
      .fill(texto)
    await gestora
      .getByRole('button', { name: 'Enviar mensagem', exact: true })
      .dblclick()
    await expect(chat(comercial).getByText(texto, { exact: true })).toHaveCount(
      1,
    )
    const saidas = (
      await controle(request, 'inspecionar', numero)
    ).mensagens.filter((m: { fromMe: boolean }) => m.fromMe)
    expect(saidas).toHaveLength(1)
    await emitir(request, numero, {
      EventType: 'messages_update',
      state: 'Read',
      type: 'ReadReceipt',
      event: {
        Type: 'Read',
        IsFromMe: true,
        IsGroup: false,
        chatid: primeiro.message.chatid,
        MessageIDs: [saidas[0].messageid],
        Timestamp: Math.floor(Date.now() / 1000),
      },
    })
    for (const page of telas)
      await expect(
        chat(page).getByRole('img', { name: 'Lida', exact: true }),
      ).toBeVisible()
    await gestora.getByRole('button', { name: 'Anexar', exact: true }).click()
    const [arquivo] = await Promise.all([
      gestora.waitForEvent('filechooser'),
      gestora.getByText('Documento', { exact: true }).click(),
    ])
    await arquivo.setFiles('e2e/uazapi/proposta.pdf')
    await gestora.getByRole('button', { name: 'Enviar documento' }).click()
    await expect(
      chat(comercial).getByRole('link', { name: /proposta.pdf/ }),
    ).toBeVisible()
    await emitir(request, numero, {
      EventType: 'connection',
      instance: { status: 'disconnected' },
    })
    for (const page of telas)
      await expect(alerta(page)).toContainText('desconectado')
    await capturar(gestora)
    await emitir(request, numero, {
      EventType: 'connection',
      instance: { status: 'connected' },
    })
    for (const page of telas) await expect(alerta(page)).toHaveCount(0)

    // Janela maior que o intervalo de 4 s do ticket 03, com a aba visível.
    await comercial.waitForLoadState('networkidle')
    expect(await comercial.evaluate(() => document.visibilityState)).toBe(
      'visible',
    )
    let leituras = 0
    comercial.on('request', (req) => {
      if (req.method() === 'GET' && req.url().includes('/_serverFn/'))
        leituras++
    })
    await new Promise((resolve) => setTimeout(resolve, 4800))
    expect(leituras).toBe(0)
    await comercial.evaluate(() => window.redeJ7.interromper())
    const durante = recebido('J7-2', 'Vou deixar a entrada lateral aberta.')
    await emitir(request, numero, durante)
    await expect(chat(comercial).getByText(durante.message.text)).toHaveCount(1)
    expect(leituras).toBeGreaterThan(0)
    await expect
      .poll(() => comercial.evaluate(() => window.redeJ7.tentativas.length), {
        timeout: 30_000,
      })
      .toBeGreaterThanOrEqual(3)
    const [a, b, c] = await comercial.evaluate(() => window.redeJ7.tentativas)
    expect(c - b).toBeGreaterThan(b - a)

    // Durante a segunda perda, o HTTP também fica fora. Na reabertura do
    // canal a tela precisa buscar o que perdeu mesmo sem nenhum novo aviso.
    await comercial.route('**/_serverFn/**', async (rota) => {
      if (await comercial.evaluate(() => window.redeJ7.conectada()))
        return rota.continue()
      return rota.abort('internetdisconnected')
    })
    const perdido = recebido('J7-3', 'Pode tocar a campainha quando chegar.')
    await emitir(request, numero, perdido)
    await expect(chat(gestora).getByText(perdido.message.text)).toHaveCount(1)
    await expect(chat(comercial).getByText(perdido.message.text)).toHaveCount(0)
    await comercial.evaluate(() => window.redeJ7.liberar())
    await expect
      .poll(() => comercial.evaluate(() => window.redeJ7.conectada()), {
        timeout: 30_000,
      })
      .toBe(true)
    await expect(chat(comercial).getByText(perdido.message.text)).toHaveCount(1)
    await expect(chat(comercial).getByText(durante.message.text)).toHaveCount(1)
    for (const avisos of [avisosGestora, avisosComercial]) {
      expect(avisos.length).toBeGreaterThan(0)
      expect(new Set(avisos)).toEqual(new Set(['mudou']))
    }
    expect(avisosPos).toEqual([])
    await expect(linha(pos)).toHaveCount(0)
  } finally {
    await Promise.all([comercial.context().close(), pos.context().close()])
    executarSqlE2E(`
      DELETE FROM contatos WHERE telefone='${telefone}';
      DELETE FROM numeros WHERE nome='${numero}';
      DELETE FROM user WHERE email IN ('qa-com-j7@exemplo.test','qa-pos-j7@exemplo.test');
    `)
    await controle(request, 'remover', numero)
  }
})
