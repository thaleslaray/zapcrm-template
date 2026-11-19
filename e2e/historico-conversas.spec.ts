import { mkdir } from 'node:fs/promises'
import { expect, type Page, test } from '@playwright/test'
import { executarSqlE2E, waitForHydration } from './helpers'
import { controle, mensagem } from './whatsapp-suporte'

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

const numero = 'Atendimento C5'
const pasta = '.scratch/zapcrm/capturas/c5'
async function capturar(page: Page, nome: string) {
  if (!process.env.ZAPCRM_CAPTURAS_C5) return
  await mkdir(pasta, { recursive: true })
  await page.screenshot({
    path: `${pasta}/${nome}.png`,
    animations: 'disabled',
  })
}

test('pareamento traz a lista do celular e o histórico anterior chega em lotes', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000)
  const nomes = [
    'Ana',
    'Bruno',
    'Camila',
    'Daniel',
    'Elisa',
    'Fernanda',
    'Gabriel',
    'Helena',
    'Isabel',
  ]
  const familias = ['Farias', 'Lopes', 'Nunes', 'Ramos', 'Viana']
  const agora = Date.now()
  const individuais = Array.from({ length: 45 }, (_, i) => {
    const fone = `552198553${String(4000 + i)}`
    return {
      id: `chat-c5-${i}`,
      wa_chatid: `${fone}@s.whatsapp.net`,
      wa_isGroup: false,
      name: `${nomes[i % nomes.length]} ${familias[Math.floor(i / nomes.length)]}`,
      wa_lastMsgTimestamp: agora - i * 60_000,
      wa_unreadCount: i === 4 ? 2 : 0,
    }
  })
  const mensagens = individuais
    .slice(0, 3)
    .map((c, i) =>
      mensagem(
        `RECENTE-C5-${i}`,
        c.name,
        c.wa_chatid.split('@')[0],
        [
          'Podemos marcar para amanhã?',
          'A proposta chegou, obrigado.',
          'Qual é o próximo horário?',
        ][i],
        { messageTimestamp: c.wa_lastMsgTimestamp },
      ),
    )
  const antigas = individuais[3]
  const telefone = antigas.wa_chatid.split('@')[0]
  const anterior = mensagem(
    'ANTERIOR-C5',
    antigas.name,
    telefone,
    'Combinamos a primeira visita na terça-feira.',
    { messageTimestamp: agora - 35 * 86_400_000 },
  )
  const botao = page.getByRole('button', {
    name: 'Carregar mensagens anteriores',
    exact: true,
  })
  const linhas = page.locator('button.row')
  const linha = (nome: string) => linhas.filter({ hasText: nome })
  await page.goto('/app/configuracoes?secao=numeros')
  const conectar = page.getByRole('button', {
    name: 'Conectar número',
    exact: true,
  })
  await waitForHydration(conectar)
  await conectar.click()
  await page.getByRole('button', { name: 'Criar número novo' }).click()
  await page.getByLabel('Nome do número', { exact: true }).fill(numero)
  await page.getByLabel('Setor', { exact: true }).selectOption('com')
  await page.getByLabel('Funil padrão', { exact: true }).selectOption('vendas')
  await page.getByRole('button', { name: 'Criar e conectar' }).click()
  await expect(page.getByAltText('QR Code de conexão')).toBeVisible()
  try {
    await controle(request, 'parear', numero, {
      chats: [
        ...individuais,
        {
          wa_chatid: '120363000@g.us',
          wa_isGroup: true,
          name: 'Grupo do celular',
        },
      ],
      mensagens,
    })
    await page.goto('/app/conversas')
    const busca = page.getByRole('searchbox', { name: 'Buscar conversa' })
    await waitForHydration(busca)
    const filtro = page.getByRole('combobox', { name: 'Número da empresa' })
    if (await filtro.count()) await filtro.selectOption({ label: numero })
    await expect(linhas).toHaveCount(45)
    await expect(linha('Grupo do celular')).toHaveCount(0)
    await expect(linha('Nenhuma mensagem ainda')).toHaveCount(42)
    await expect(linha(antigas.name)).toBeVisible()
    await linha(individuais[0].name).click()
    await expect(
      page
        .getByRole('heading', { name: individuais[0].name, exact: true })
        .last(),
    ).toBeVisible()
    await expect(
      page
        .getByRole('complementary', { name: 'Painel do contato' })
        .getByText(individuais[0].name, { exact: true }),
    ).toBeVisible()
    await capturar(page, 'lista-claro')
    const escuro = page.getByRole('button', {
      name: 'Mudar para o modo escuro',
    })
    await escuro.click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(linha(antigas.name)).toBeVisible()
    await capturar(page, 'lista-escuro')
    await linha(antigas.name).click()
    await expect(
      page.getByText('Nenhuma mensagem nesta conversa.', { exact: true }),
    ).toBeVisible()
    await expect(botao).toBeEnabled()
    await capturar(page, 'anteriores-escuro')
    await page.getByRole('button', { name: 'Mudar para o modo claro' }).click()
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    await capturar(page, 'anteriores-claro')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(botao).toBeVisible()
    await capturar(page, 'anteriores-celular')
    await page.getByRole('button', { name: 'Voltar', exact: true }).click()
    await expect(linha(antigas.name)).toBeVisible()
    await capturar(page, 'lista-celular')
    await linha(antigas.name).click()
    await botao.click()
    await expect(page.getByText(/pedido enviado/i).first()).toBeVisible()
    const proximo = {
      number: antigas.wa_chatid,
      count: 50,
      messageid: anterior.messageid,
      timestamp: anterior.messageTimestamp,
      fromMe: false,
    }
    await controle(request, 'entregar-anteriores', numero, {
      chat: antigas.wa_chatid,
      mensagens: [anterior],
      resultado: { status: 'completed', has_more: true, next_request: proximo },
    })
    await expect(page.getByRole('log').getByText(anterior.text)).toBeVisible()
    await botao.click()
    await expect(page.getByText(/pedido enviado/i).first()).toBeVisible()
    const final = await controle(request, 'entregar-anteriores', numero, {
      chat: antigas.wa_chatid,
      resultado: { status: 'completed', has_more: false },
    })
    expect(final.pedido).toMatchObject(proximo)
    await expect(
      page.getByText('Você chegou ao início da conversa.'),
    ).toBeVisible()
    await expect(botao).toHaveCount(0)
    await page.getByRole('button', { name: 'Voltar', exact: true }).click()
    await linha(individuais[4].name).click()
    await botao.click()
    await expect(page.getByText(/pedido enviado/i).first()).toBeVisible()
    await controle(request, 'entregar-anteriores', numero, {
      chat: individuais[4].wa_chatid,
      resultado: { status: 'timeout', has_more: null },
    })
    await expect(page.getByText(/abra o WhatsApp no celular/i)).toBeVisible()
    await expect(botao).toBeEnabled()

    for (const desfecho of [
      {
        chat: individuais[5],
        resultado: {
          status: 'completed',
          has_more: true,
          history_access: 'unavailable',
        },
        texto: /restante da conversa não está acessível/i,
      },
      {
        chat: individuais[6],
        resultado: {
          status: 'blocked',
          has_more: true,
          success: false,
          error: 'pagination_no_progress',
        },
        texto: /celular repetiu a mesma página/i,
      },
    ]) {
      await page.getByRole('button', { name: 'Voltar', exact: true }).click()
      await linha(desfecho.chat.name).click()
      await botao.click()
      await expect(page.getByText(/pedido enviado/i).first()).toBeVisible()
      await controle(request, 'entregar-anteriores', numero, {
        chat: desfecho.chat.wa_chatid,
        resultado: desfecho.resultado,
      })
      await expect(page.getByText(desfecho.texto)).toBeVisible()
      await expect(botao).toHaveCount(0)
    }

    // Simula um número pareado cujo webhook deixou de entregar um chat.
    await controle(request, 'guardar', numero, {
      chats: [
        { wa_chatid: '5521985534100@s.whatsapp.net', name: 'Rita Coelho' },
      ],
    })
    await page.goto('/app/configuracoes?secao=numeros')
    const sincronizar = page
      .locator('.numcard')
      .filter({ hasText: numero })
      .getByRole('button', { name: 'Sincronizar conversas' })
    await waitForHydration(sincronizar)
    await sincronizar.click()
    await expect(
      page.getByText(/46 conversas sincronizadas.*0 mensagens novas/i),
    ).toBeVisible()
    await page.goto('/app/conversas')
    await expect(linha('Rita Coelho')).toBeVisible()
  } finally {
    executarSqlE2E(
      `DELETE FROM contatos WHERE id IN (SELECT c.contato_id FROM conversas c JOIN numeros n ON n.id=c.numero_id WHERE n.nome='Atendimento C5'); DELETE FROM numeros WHERE nome='Atendimento C5'`,
    )
    await controle(request, 'remover', numero)
  }
})
