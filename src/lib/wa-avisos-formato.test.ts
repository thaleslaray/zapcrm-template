import { expect, it } from 'vitest'
import { lerAviso, lerPareamento } from './wa-avisos-formato'

it.each([
  ['registering', 'conectando'],
  ['registration_conflict', 'desconectado'],
  ['estado-futuro', 'desconectado'],
])('traduz o estado %s no pareamento e no aviso', (status, estado) => {
  const instance = { status }
  expect(lerPareamento({ instance }).estado).toBe(estado)
  expect(lerAviso({ EventType: 'connection', instance })).toMatchObject([
    { estado },
  ])
})

it('ignora o próprio telefone nos nomes da sincronização e dos avisos', () => {
  const chat = {
    wa_chatid: '5511918632193@s.whatsapp.net',
    name: '+55 (11) 91863-2193',
    phone: '+55 (11) 91863-2193',
  }
  const historico = (dados: object) =>
    lerAviso({ EventType: 'history', event: 'chats', chats: [dados] })
  expect(historico(chat)).toMatchObject([
    { chats: [{ nome: null, telefone: '5511918632193' }] },
  ])
  expect(historico({ ...chat, wa_name: 'Ana' })).toMatchObject([
    { chats: [{ nome: 'Ana' }] },
  ])
  expect(lerAviso({ EventType: 'chats', chat })).toEqual([])
  expect(
    lerAviso({
      EventType: 'messages',
      chat,
      message: {
        chatid: chat.wa_chatid,
        messageid: 'm1',
        messageTimestamp: 1700000000000,
        text: 'Oi',
        senderName: 'Ana',
      },
    }),
  ).toMatchObject([{ mensagens: [{ nome: 'Ana' }] }])
})
