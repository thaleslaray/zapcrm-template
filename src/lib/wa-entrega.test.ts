import { expect, it } from 'vitest'
import { getDb } from '#/db'
import { mensagens, numeros } from '#/db/schema'
import { createAuthHarness } from '#/test/auth-harness'
import { processarAviso } from './wa-avisos'

const credencial = {
  endereco: 'http://localhost:3233',
  token: 'teste',
  vinculo: 'cifra-da-linha',
}

it('falhas de envio e mensagens apagadas respeitam os recibos fora de ordem', async () => {
  const h = await createAuthHarness()
  try {
    await h.signIn('qa-entrega@exemplo.test')
    const db = getDb(h.db)
    await db.insert(numeros).values({
      id: 'linha',
      nome: 'Loja',
      setorId: 'com',
      funilPadraoId: 'vendas',
      tokenCifrado: credencial.vinculo,
      cor: '#123',
    })
    const chatid = '5511984213307@s.whatsapp.net'
    const eco = (id: string, status: string) =>
      processarAviso(h.env, 'linha', credencial, {
        EventType: 'messages',
        message: {
          messageid: id,
          fromMe: true,
          text: 'Oi',
          chatid,
          messageTimestamp: 1700000000000,
          status,
        },
      })
    const recibo = (id: string, state: string) =>
      processarAviso(h.env, 'linha', credencial, {
        EventType: 'messages_update',
        type: 'ReadReceipt',
        state,
        event: { MessageIDs: [id], chatid },
      })
    for (const status of ['Failed', 'Expired', 'Canceled']) {
      await eco(status, 'Sent')
      await eco(status, status)
      await eco(status, 'Deleted')
      await recibo(status, 'Deleted')
      await recibo(`cedo${status}`, status)
      await eco(`cedo${status}`, 'Sent')
      await eco(`tarde${status}`, 'Sent')
      await recibo(`tarde${status}`, status)
    }
    for (const status of ['Delivered', 'Read']) {
      await eco(status, status)
      await eco(status, 'Failed')
      await recibo(status, 'Expired')
    }
    await eco('fila', 'Queued')
    await eco('fila', 'Deleted')
    const estados = Object.fromEntries(
      (await db.select().from(mensagens)).map((m) => [
        m.identificador,
        m.estado,
      ]),
    )
    expect(estados).toEqual({
      Failed: 'falha',
      Expired: 'falha',
      Canceled: 'falha',
      cedoFailed: 'falha',
      cedoExpired: 'falha',
      cedoCanceled: 'falha',
      tardeFailed: 'falha',
      tardeExpired: 'falha',
      tardeCanceled: 'falha',
      Delivered: 'entregue',
      Read: 'lida',
      fila: 'fila',
    })
  } finally {
    await h.dispose()
  }
})
