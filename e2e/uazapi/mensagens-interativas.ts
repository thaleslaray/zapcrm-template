const cobranca = {
  chatid: '5511918647011@s.whatsapp.net',
  senderName: 'Solar Cobranças',
}
const atendimento = {
  chatid: '5511918647012@s.whatsapp.net',
  senderName: 'Solar Atendimento',
}

// Corpos medidos na uazapi 3.0.0c. O transporte de teste aceita estes registros
// tanto na busca de histórico quanto no webhook de mensagem individual.
export function mensagensInterativas() {
  const agora = Date.now()
  function registro(
    id: string,
    messageType: string,
    dados: Record<string, unknown>,
    contato = cobranca,
    messageTimestamp = agora,
  ) {
    return {
      id: `551140028922:C7-${id}`,
      messageid: `C7-${id}`,
      fromMe: false,
      isGroup: false,
      ...contato,
      messageTimestamp,
      messageType,
      ...dados,
    }
  }
  const fluxo = {
    body: { text: 'Como podemos ajudar?' },
    footer: { text: 'Equipe Solar' },
    InteractiveMessage: {
      NativeFlowMessage: {
        buttons: [
          {
            name: 'cta_url',
            buttonParamsJSON: JSON.stringify({
              display_text: 'Consultar fatura',
              url: 'https://pagamentos.invalid/fatura-privada',
            }),
          },
          {
            name: 'quick_reply',
            buttonParamsJSON: '{"display_text":"Pedir atendimento"}',
          },
          {
            name: 'cta_copy',
            buttonParamsJSON: '{"display_text":"Copiar referência"}',
          },
          {
            name: 'cta_call',
            buttonParamsJSON: '{"display_text":"Ligar para a equipe"}',
          },
        ],
      },
    },
  }
  return {
    modelos: [
      registro(
        'TEMPLATE',
        'TemplateMessage',
        {
          content: { Format: { InteractiveMessageTemplate: fluxo } },
        },
        atendimento,
        agora - 60_000,
      ),
      registro(
        'HIDRATADO',
        'TemplateMessage',
        {
          content: JSON.stringify({
            Format: {
              HydratedFourRowTemplate: {
                Title: { HydratedTitleText: 'Segunda via' },
                hydratedContentText: 'Escolha o canal de entrega.',
                hydratedFooterText: 'Central de atendimento',
                hydratedButtons: [
                  {
                    HydratedButton: {
                      HydratedQuickReplyButton: {
                        DisplayText: 'Receber por e-mail',
                      },
                    },
                  },
                ],
              },
            },
          }),
        },
        atendimento,
        agora - 50_000,
      ),
      registro(
        'DIRETA',
        'NativeFlowMessage',
        { content: fluxo },
        atendimento,
        agora - 40_000,
      ),
      registro(
        'RESPOSTA-BOTAO',
        'ButtonsResponseMessage',
        {
          content: { Response: { SelectedDisplayText: 'Pedir atendimento' } },
        },
        atendimento,
        agora - 30_000,
      ),
      registro(
        'RESPOSTA-TEMPLATE',
        'TemplateButtonReplyMessage',
        {
          content: { selectedDisplayText: 'Receber por e-mail' },
        },
        atendimento,
        agora - 20_000,
      ),
    ],
    botoes: registro('BOTOES', 'ButtonsMessage', {
      content: {
        contentText: 'Sua *fatura* está disponível. Como deseja continuar?',
        buttons: [
          { buttonText: { displayText: 'Código para pagamento' } },
          { buttonText: { displayText: 'Já efetuei o pagamento' } },
          { buttonText: { displayText: 'Bloquear' } },
        ],
      },
    }),
    lista: registro(
      'LISTA',
      'ListMessage',
      {
        text: 'Escolha uma forma de pagamento.',
        content: JSON.stringify({
          description: 'Escolha uma forma de pagamento.',
          buttonText: 'Formas de pagamento',
          sections: [
            {
              rows: [
                { title: 'Pix', description: 'Confirmação imediata' },
                { title: 'Boleto', description: 'Vencimento em três dias' },
              ],
            },
          ],
        }),
      },
      cobranca,
      agora + 1,
    ),
    resposta: registro(
      'RESPOSTA-LISTA',
      'ListResponseMessage',
      {
        vote: 'Pix',
        fromMe: true,
        content: { title: 'Pix' },
      },
      cobranca,
      agora + 2,
    ),
  }
}
