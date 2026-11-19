import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { Mensagens } from './mensagens'

it('mantém a formatação do corpo e apresenta as opções como texto acessível', () => {
  const html = renderToStaticMarkup(
    <Mensagens
      lista={[
        {
          id: 'cobranca',
          tipo: 'texto',
          texto: '*Fatura* disponível',
          editada: false,
          interativa: {
            rodape: 'Central de pagamentos',
            botaoLista: null,
            opcoes: [{ tipo: 'link', rotulo: 'Ver fatura' }],
          },
          estado: 'lida',
          direcao: 'recebida',
          instante: new Date(2026, 10, 19),
          tentativaEm: null,
          confirmada: 1,
          nomeArquivo: null,
          bytes: null,
          duracao: null,
          temArquivo: 0,
        },
      ]}
      nome="Loja"
      termo=""
      repetir={() => {}}
      historico={null}
      carregado
    />,
  )
  expect(html).toContain('<strong>Fatura</strong> disponível')
  expect(html).toContain('Central de pagamentos')
  expect(html).toContain('aria-label="Botão da mensagem: Ver fatura"')
  expect(html).not.toMatch(/<(button|a)\b|tabindex=/i)
})
