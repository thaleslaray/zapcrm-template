import { expect, it } from 'vitest'
import { getDb } from '#/db'
import { createAuthHarness } from '#/test/auth-harness'
import { processarAviso } from './wa-avisos'
import { importarChats } from './wa-chats'
import { listarConversas } from './wa-conversas'

const credencial = {
  endereco: 'http://localhost:3233',
  token: 'teste',
  vinculo: 'teste-previas',
}
const telefone = '5511912345678'
const jid = `${telefone}@s.whatsapp.net`
const outro = '5511987654321@s.whatsapp.net'
const dono = '5511936363636'
const instante = 1760000000000

it('mostra a prévia do chat, preserva a anterior à reação e escolhe a mensagem gravada mais nova', async () => {
  const h = await createAuthHarness()
  try {
    const {
      body: { user },
    } = await h.signIn('qa-previa@exemplo.test')
    await h.db
      .prepare(
        "INSERT INTO numeros(id,nome,telefone,token_cifrado,setor_id,funil_padrao_id,cor,estado_em) VALUES('linha','Loja',?,?,'com','vendas','#123',1)",
      )
      .bind(dono, credencial.vinculo)
      .run()
    const chat = {
      wa_chatid: jid,
      wa_lastMessageType: 'ExtendedTextMessage',
      wa_lastMessageTextVote: 'Já separei o pedido',
      wa_lastMessageSender: `${dono}@s.whatsapp.net`,
      owner: dono,
      wa_lastMsgTimestamp: instante,
    }
    const importar = (...chats: object[]) =>
      importarChats(h.env, 'linha', credencial, chats)
    const lista = async () =>
      (await listarConversas(getDb(h.db), user.id)).lista
    const gravar = (id: string, em: number, texto: string) =>
      processarAviso(h.env, 'linha', credencial, {
        EventType: 'history',
        event: 'messages',
        messages: [
          { chatid: jid, messageid: id, text: texto, messageTimestamp: em },
        ],
      })
    await importar(chat)
    await gravar('antiga', instante - 2000, 'Recebi a proposta')
    expect((await lista())[0]).toMatchObject({
      resumo: 'Já separei o pedido',
      ultimaDirecao: 'enviada',
      ultimaEstado: null,
    })
    const reacao = {
      ...chat,
      wa_lastMessageType: 'ReactionMessage',
      wa_lastMessageTextVote: '👍',
      wa_lastMessageSender: jid,
      wa_lastMsgTimestamp: instante + 2000,
    }
    await importar(reacao, { ...reacao, wa_chatid: outro })
    const linhas = await lista()
    expect(linhas.find((l) => l.telefone === telefone)).toMatchObject({
      resumo: 'Já separei o pedido',
    })
    expect(linhas.find((l) => l.telefone !== telefone)).toMatchObject({
      resumo: '',
    })
    await gravar('nova', instante + 3000, 'Consegui retirar')
    await importar(chat)
    expect((await lista())[0]).toMatchObject({
      resumo: 'Consegui retirar',
      ultimaDirecao: 'recebida',
    })
  } finally {
    await h.dispose()
  }
})

it('lista a legenda ou o rótulo de cada tipo de mídia e deixa vazia a conversa sem mensagem', async () => {
  const h = await createAuthHarness()
  try {
    const {
      body: { user },
    } = await h.signIn('qa-midiasprevia@exemplo.test')
    await h.db
      .prepare(
        "INSERT INTO numeros(id,nome,telefone,token_cifrado,setor_id,funil_padrao_id,cor,estado_em) VALUES('linha','Loja',?,?,'com','vendas','#123',1)",
      )
      .bind(dono, credencial.vinculo)
      .run()
    const casos = [
      ['ImageMessage', '', 'Foto'],
      ['AudioMessage', '', 'Áudio'],
      ['VideoMessage', '', 'Vídeo'],
      ['StickerMessage', '', 'Figurinha'],
      ['DocumentMessage', '', 'Documento'],
      ['ImageMessage', 'Nota fiscal', 'Nota fiscal'],
      ['UnknownMessageType', 'Aprovar pedido', 'Aprovar pedido'],
      ['Conversation', 'Confirmado', 'Confirmado'],
      ['', '', null],
    ] as const
    await importarChats(
      h.env,
      'linha',
      credencial,
      casos.map(([tipo, texto], i) => ({
        wa_chatid: `551199999900${i}@s.whatsapp.net`,
        wa_lastMessageType: tipo,
        wa_lastMessageTextVote: texto,
        wa_lastMsgTimestamp: instante - i,
      })),
    )
    const { lista } = await listarConversas(getDb(h.db), user.id)
    expect(lista.map((l) => l.resumo)).toEqual(casos.map((c) => c[2]))
  } finally {
    await h.dispose()
  }
})
