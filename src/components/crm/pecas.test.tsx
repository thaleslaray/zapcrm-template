import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { Avatar } from './pecas'

it('mantém as iniciais e carrega a foto pela rota privada do contato', () => {
  const html = renderToStaticMarkup(
    <Avatar nome="Ana Maria" contatoId="cliente/123" tamanho={30} />,
  )
  expect(html).toContain('>AM<')
  expect(html).toContain('src="/api/contatos/cliente%2F123/foto"')
  expect(html).toContain('loading="lazy"')
  expect(renderToStaticMarkup(<Avatar nome="Equipe" />)).not.toContain('<img')
})
