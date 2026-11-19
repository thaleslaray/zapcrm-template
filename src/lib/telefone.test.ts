import { expect, it } from 'vitest'

import { nomeDoContato, normalizarTelefone } from '#/lib/telefone'

it('reconhece o mesmo contato brasileiro com e sem o nono dígito', () => {
  expect(normalizarTelefone('+55 (11) 98421-3307')).toBe('551184213307')
  expect(normalizarTelefone('11 8421-3307')).toBe('551184213307')
  expect(normalizarTelefone('(11) 4002-8922')).toBe('551140028922')
})

it('exibe o telefone brasileiro sem alterar os dígitos ou o nome real', () => {
  expect(
    nomeDoContato({ nome: '5511918632193', telefone: '5511918632193' }),
  ).toBe('+55 11 91863-2193')
  expect(
    nomeDoContato({ nome: 'Contato do WhatsApp', telefone: '552140028922' }),
  ).toBe('+55 21 4002-8922')
  expect(
    nomeDoContato({
      nome: '11918632193',
      telefone: '11918632193',
      telefoneNormalizado: '551118632193',
    }),
  ).toBe('+55 11 91863-2193')
  expect(
    nomeDoContato({ nome: '+55 (11) 1863-2193', telefone: '5511918632193' }),
  ).toBe('+55 11 91863-2193')
  expect(nomeDoContato({ nome: 'Loja 123', telefone: '5511918632193' })).toBe(
    'Loja 123',
  )
  expect(nomeDoContato({ nome: '14155550123', telefone: '14155550123' })).toBe(
    '+14155550123',
  )
})
