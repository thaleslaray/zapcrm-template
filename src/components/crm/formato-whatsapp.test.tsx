import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { formatarWhatsApp } from './formato-whatsapp'

const html = (t: string) => renderToStaticMarkup(<>{formatarWhatsApp(t)}</>)

it('aplica negrito, itálico, tachado e código como o WhatsApp', () => {
  expect(html('*Aviso importante:* sua fatura de *R$ 204,46* segue')).toBe(
    '<strong>Aviso importante:</strong> sua fatura de <strong>R$ 204,46</strong> segue',
  )
  expect(html('_oi_ ~não~ `x*y`')).toBe(
    '<em>oi</em> <s>não</s> <code>x*y</code>',
  )
  expect(html('*_junto_*')).toBe('<strong><em>junto</em></strong>')
})

it('deixa como está o que não é marca de formatação', () => {
  expect(html('2 * 3 * 4')).toBe('2 * 3 * 4')
  expect(html('nome_de_arquivo e a*b*c')).toBe('nome_de_arquivo e a*b*c')
  expect(html('*sem fim')).toBe('*sem fim')
  expect(html('*uma\nlinha*')).toBe('*uma\nlinha*')
})

it('nunca interpreta HTML vindo da mensagem', () => {
  expect(html('*<img src=x onerror=alert(1)>*')).toBe(
    '<strong>&lt;img src=x onerror=alert(1)&gt;</strong>',
  )
})
