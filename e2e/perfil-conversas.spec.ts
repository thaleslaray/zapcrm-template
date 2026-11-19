import { mkdir } from 'node:fs/promises'
import { expect, type Page, test } from '@playwright/test'
import { executarSqlE2E, loginWithCode, waitForHydration } from './helpers'
import { controle, mensagem } from './whatsapp-suporte'

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

async function capturar(page: Page, nome: string) {
  if (!process.env.ZAPCRM_CAPTURAS_C6) return
  const pasta = '.scratch/zapcrm/capturas/c6'
  await mkdir(pasta, { recursive: true })
  await page.screenshot({
    path: `${pasta}/${nome}.png`,
    animations: 'disabled',
  })
}

test('sincroniza fotos, prévias e não lidas em ordem e protege a foto entre setores', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(120_000)
  const numero = 'Atendimento C6'
  const email = 'qa-vendedor-c6@exemplo.test'
  const origem = 'http://127.0.0.1:3233'
  const foto = `${origem}/arquivo/avatar`
  const contatos = [
    {
      fone: '5511918632188',
      nome: 'Helena Prado',
      texto: 'Podemos agendar a visita para sexta?',
      tipo: 'Conversation',
      imagem: foto,
    },
    {
      fone: '5511918632193',
      nome: '',
      texto: '',
      tipo: 'AudioMessage',
      imagem: `${origem}/arquivo/foto?oe=1`,
    },
    {
      fone: '5511918632160',
      nome: 'Mateus Lima',
      texto: 'Vou conferir as medidas.',
      tipo: 'ExtendedTextMessage',
      imagem: '',
    },
  ]
  const agora = Date.now()
  const chats = contatos.map(({ fone, nome, texto, tipo, imagem }, i) => ({
    wa_chatid: `${fone}@s.whatsapp.net`,
    wa_isGroup: false,
    wa_contactName: nome,
    name: nome || fone,
    phone: `+55 11 91863-${fone.slice(-4)}`,
    imagePreview: imagem,
    image: '',
    owner: '551140028922',
    wa_lastMessageSender:
      i === 2 ? '551140028922@s.whatsapp.net' : `${fone}@s.whatsapp.net`,
    wa_lastMessageType: tipo,
    wa_lastMessageTextVote: texto,
    wa_lastMsgTimestamp: agora - (i + 1) * 60_000,
    wa_unreadCount: i === 0 ? 4 : 0,
  }))
  await controle(request, 'preparar', numero)
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
    await controle(request, 'guardar', numero, {
      chats: [...chats].reverse(),
      mensagens: [
        mensagem(
          'C6-MATEUS',
          'Mateus Lima',
          contatos[2].fone,
          'Já tenho as medidas do telhado.',
          { messageTimestamp: agora },
        ),
      ],
    })
    const sincronizar = page
      .locator('.numcard')
      .filter({ hasText: numero })
      .getByRole('button', { name: 'Sincronizar conversas' })
    await waitForHydration(sincronizar)
    await sincronizar.click()
    await expect(page.getByText(/3 conversas sincronizadas/i)).toBeVisible()
    await page.goto('/app/conversas')
    const busca = page.getByRole('searchbox', { name: 'Buscar conversa' })
    await waitForHydration(busca)
    const filtro = page.getByRole('combobox', { name: 'Número da empresa' })
    if (await filtro.count()) await filtro.selectOption({ label: numero })
    const linhas = page.locator('button.row')
    await expect(linhas.locator('.nm')).toHaveText([
      'Mateus Lima',
      'Helena Prado',
      '+55 11 91863-2193',
    ])
    await expect(linhas.locator('.pv .t')).toHaveText([
      'Já tenho as medidas do telhado.',
      contatos[0].texto,
      'Áudio',
    ])
    await expect(linhas.nth(1).locator('.badge')).toHaveText('4')
    await expect(linhas.first().locator('.av').first()).toHaveText('ML')
    for (const i of [1, 2]) {
      const img = linhas.nth(i).locator('img.foto-contato')
      await expect(img).toHaveAttribute('src', /^\/api\/contatos\/[^/]+\/foto$/)
      await expect
        .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
        .toBeGreaterThan(0)
    }
    const privado = await linhas
      .nth(1)
      .locator('img.foto-contato')
      .getAttribute('src')
    if (!privado) throw new Error('A foto privada de Helena está ausente.')
    const semFoto = await linhas
      .first()
      .locator('img.foto-contato')
      .getAttribute('src')
    if (!semFoto)
      throw new Error('O contato sem foto precisa de uma rota privada.')
    expect((await page.request.get(semFoto)).status()).toBe(404)
    await busca.fill('5511918632193')
    await expect(linhas).toHaveCount(1)
    await busca.fill('')
    await linhas.first().click()
    await expect(
      page.getByRole('log').getByText('Já tenho as medidas do telhado.'),
    ).toBeVisible()
    await capturar(page, 'conversas-claro')
    await page.getByRole('button', { name: 'Mudar para o modo escuro' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await capturar(page, 'conversas-escuro')
    await page.getByRole('button', { name: 'Mudar para o modo claro' }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Voltar', exact: true }).click()
    await expect(linhas.nth(2)).toBeInViewport()
    await capturar(page, 'conversas-celular')
    await page.setViewportSize({ width: 1440, height: 900 })
    await linhas.nth(1).click()
    const imagemHelena = `img[src="${privado}"]`
    for (const zona of [
      '.chat-head',
      'aside[aria-label="Painel do contato"]',
    ]) {
      await expect(page.locator(zona).locator(imagemHelena)).toHaveCSS(
        'opacity',
        '1',
      )
    }
    await page.goto('/app/contatos')
    await expect(
      page
        .getByRole('row')
        .filter({ hasText: 'Helena Prado' })
        .locator(imagemHelena),
    ).toHaveCSS('opacity', '1')
    // O histórico importado não abre negócio. Cria um para conferir o cartão do Funil.
    executarSqlE2E(`INSERT INTO negocios(id,contato_id,numero_id,funil_id,etapa_id)
      SELECT 'negocio-c6',c.id,n.id,'vendas',e.id FROM contatos c JOIN conversas cv ON cv.contato_id=c.id
      JOIN numeros n ON n.id=cv.numero_id JOIN etapas e ON e.funil_id='vendas' AND e.fechamento IS NULL
      WHERE n.nome='${numero}' AND c.telefone='${contatos[0].fone}' ORDER BY e.posicao LIMIT 1`)
    await page.goto('/app/funil?funil=vendas')
    await expect(
      page
        .locator('.card-link')
        .filter({ hasText: 'Helena Prado' })
        .locator(imagemHelena),
    ).toHaveCSS('opacity', '1')
    const outro = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      storageState: { cookies: [], origins: [] },
    })
    try {
      expect((await outro.request.get(privado)).status()).toBe(401)
      const vendedor = await outro.newPage()
      await vendedor.goto('/login')
      await loginWithCode(vendedor, email)
      await expect(vendedor).toHaveURL(/app\/conversas/)
      executarSqlE2E(
        `INSERT INTO pessoas_setores(usuario_id,setor_id) SELECT id,'pos' FROM user WHERE email='${email}'`,
      )
      expect([403, 404]).toContain(
        (await vendedor.request.get(privado)).status(),
      )
    } finally {
      await outro.close()
    }
  } finally {
    executarSqlE2E(`DELETE FROM contatos WHERE id IN (SELECT c.contato_id FROM conversas c JOIN numeros n ON c.numero_id=n.id WHERE n.nome='${numero}');
      DELETE FROM numeros WHERE nome='${numero}'; DELETE FROM user WHERE email='${email}';`)
    await controle(request, 'remover', numero)
  }
})
