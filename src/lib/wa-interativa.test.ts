import { expect, it } from 'vitest'
import { lerMensagem } from './wa-avisos-formato'

function ler(messageType: string, content: unknown, campos: object = {}) {
  return lerMensagem({
    messageid: 'pedido-1',
    chatid: '5511984213307@s.whatsapp.net',
    messageTimestamp: 1700000000000,
    messageType,
    content,
    ...campos,
  })
}

it('lê o corpo e os botões de ButtonsMessage sem text', () => {
  const msg = ler('ButtonsMessage', {
    contentText: 'Acompanhe seu pedido',
    footerText: 'Atendimento da loja',
    buttons: [
      {
        buttonId: 'interno',
        buttonText: { displayText: 'Código para pagamento' },
      },
      { buttonText: { displayText: 'Já efetuei o pagamento' } },
    ],
  })
  expect(msg?.texto).toBe('Acompanhe seu pedido')
  expect(msg?.interativa).toEqual({
    rodape: 'Atendimento da loja',
    botaoLista: null,
    opcoes: [
      { tipo: 'resposta', rotulo: 'Código para pagamento' },
      { tipo: 'resposta', rotulo: 'Já efetuei o pagamento' },
    ],
  })
})

it('lê ListMessage em JSON, preserva as seções em ordem e usa text quando presente', () => {
  const lista = JSON.stringify({
    description: 'Escolha como receber',
    buttonText: 'Ver opções',
    sections: [
      {
        rows: [
          {
            title: 'Entrega',
            description: 'Em até dois dias',
            rowId: 'dados privados',
          },
        ],
      },
      { rows: [{ title: 'Retirada' }] },
    ],
  })
  expect(ler('ListMessage', lista)).toMatchObject({
    texto: 'Escolha como receber',
    interativa: {
      botaoLista: 'Ver opções',
      opcoes: [
        { tipo: 'item', rotulo: 'Entrega', descricao: 'Em até dois dias' },
        { tipo: 'item', rotulo: 'Retirada' },
      ],
    },
  })
  expect(ler('ListMessage', lista, { text: 'Texto do WhatsApp' })?.texto).toBe(
    'Texto do WhatsApp',
  )
})

const botoesNativos = [
  ['cta_url', 'Consultar', 'link'],
  ['quick_reply', 'Respondido', 'resposta'],
  ['cta_copy', 'Copiar código', 'copiar'],
  ['cta_call', 'Ligar para a loja', 'ligacao'],
].map(([name, rotulo, tipo]) => ({
  botao: {
    name,
    buttonParamsJSON: JSON.stringify({
      display_text: rotulo,
      url: 'https://destino.invalid/privado',
      copy_code: 'segredo',
    }),
  },
  esperado: { tipo, rotulo },
}))
const fluxo = { buttons: botoesNativos.map((b) => b.botao) }
const conteudo = {
  body: { text: 'Seu comprovante' },
  footer: { text: 'Loja' },
  InteractiveMessage: { NativeFlowMessage: fluxo },
}

it.each([
  ['TemplateMessage', { Format: { InteractiveMessageTemplate: conteudo } }],
  ['InteractiveMessage', conteudo],
  [
    'NativeFlowMessage',
    { body: conteudo.body, footer: conteudo.footer, ...fluxo },
  ],
])(
  'lê os quatro tipos de botão de %s e descarta destinos e parâmetros',
  (tipo, content) => {
    const msg = ler(String(tipo), JSON.stringify(content))
    expect(msg?.texto).toBe('Seu comprovante')
    expect(msg?.interativa).toEqual({
      rodape: 'Loja',
      botaoLista: null,
      opcoes: botoesNativos.map((b) => b.esperado),
    })
    expect(JSON.stringify(msg)).not.toContain('destino.invalid')
  },
)

it('lê título, corpo, rodapé e rótulos do HydratedFourRowTemplate com variações de caixa', () => {
  const msg = ler('TemplateMessage', {
    Format: {
      HydratedFourRowTemplate: {
        Title: { HydratedTitleText: 'Fatura' },
        hydratedContentText: 'Vencimento amanhã',
        hydratedFooterText: 'Financeiro',
        hydratedButtons: [
          {
            HydratedButton: {
              HydratedURLButton: {
                displayText: 'Abrir',
                url: 'https://destino.invalid',
              },
            },
          },
          {
            HydratedButton: {
              QuickReplyButton: { HydratedDisplayText: 'Entendi', ID: '123' },
            },
          },
          {
            HydratedButton: {
              HydratedCallButton: {
                DISPLAYTEXT: 'Falar',
                phoneNumber: '123456',
              },
            },
          },
        ],
      },
    },
  })
  expect(msg?.texto).toBe('Fatura\nVencimento amanhã')
  expect(msg?.interativa).toEqual({
    rodape: 'Financeiro',
    botaoLista: null,
    opcoes: [
      { tipo: 'link', rotulo: 'Abrir' },
      { tipo: 'resposta', rotulo: 'Entendi' },
      { tipo: 'ligacao', rotulo: 'Falar' },
    ],
  })
})

it.each([
  ['ButtonsResponseMessage', { Response: { SelectedDisplayText: 'Aceito' } }],
  ['ListResponseMessage', { title: 'Aceito' }],
  ['TemplateButtonReplyMessage', { selectedDisplayText: 'Aceito' }],
])('lê a escolha de %s no conteúdo e prioriza vote', (tipo, content) => {
  expect(ler(String(tipo), JSON.stringify(content))).toMatchObject({
    texto: 'Aceito',
    interativa: null,
  })
  expect(
    ler(String(tipo), content, {
      vote: 'Minha escolha',
      text: 'Texto secundário',
    })?.texto,
  ).toBe('Minha escolha')
})

it('limita a doze opções válidas e oitenta caracteres por rótulo, inclusive nas respostas', () => {
  const longo = 'á'.repeat(81)
  const msg = ler('ListMessage', {
    buttonText: longo,
    sections: [
      {
        rows: [
          null,
          {},
          ...Array.from({ length: 15 }, () => ({ title: longo })),
        ],
      },
    ],
  })
  expect(msg?.interativa?.opcoes).toHaveLength(12)
  expect(msg?.interativa?.opcoes[11].rotulo).toBe('á'.repeat(80))
  expect(msg?.interativa?.botaoLista).toBe('á'.repeat(80))
  expect(ler('ListResponseMessage', {}, { vote: longo })?.texto).toBe(
    'á'.repeat(80),
  )
  const comEmoji = `${'á'.repeat(79)}📦`
  expect(
    ler('ButtonsResponseMessage', {}, { vote: `${comEmoji}!` })?.texto,
  ).toBe(comEmoji)
})

it('descarta conteúdo malformado sem exibir JSON bruto nem perder os outros botões', () => {
  for (const content of [
    '{"url":',
    'null',
    42,
    ['incompleto'],
    { buttons: {} },
  ]) {
    expect(ler('ButtonsMessage', content)).toMatchObject({
      texto: 'Mensagem não suportada',
      interativa: null,
    })
  }
  expect(
    ler('NativeFlowMessage', {
      buttons: [
        null,
        { name: 'cta_url', buttonParamsJSON: '{malformado' },
        fluxo.buttons[1],
      ],
    })?.interativa?.opcoes,
  ).toEqual([botoesNativos[1].esperado])
})

it('lê o modelo hidratado que vem direto no conteúdo, como na cobrança de uma operadora', () => {
  const m = lerMensagem({
    messageid: 'MODELO-DIRETO',
    chatid: '5511984213307@s.whatsapp.net',
    messageTimestamp: 1700000000000,
    messageType: 'TemplateMessage',
    content: {
      Format: {},
      templateID: '1',
      hydratedTemplate: {
        Title: { HydratedTitleText: '' },
        hydratedContentText: 'Sua fatura segue em aberto.',
        hydratedButtons: [
          {
            HydratedButton: {
              QuickReplyButton: {
                ID: 'a',
                displayText: 'Código para pagamento',
              },
            },
            index: 0,
          },
          {
            HydratedButton: {
              QuickReplyButton: {
                ID: 'b',
                displayText: 'Já efetuei o pagamento',
              },
            },
            index: 1,
          },
          {
            HydratedButton: {
              QuickReplyButton: { ID: 'c', displayText: 'Bloquear' },
            },
            index: 2,
          },
        ],
      },
    },
  })
  expect(m?.texto).toBe('Sua fatura segue em aberto.')
  expect(m?.interativa?.opcoes.map((o) => o.rotulo)).toEqual([
    'Código para pagamento',
    'Já efetuei o pagamento',
    'Bloquear',
  ])
})
