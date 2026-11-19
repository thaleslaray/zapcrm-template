import { expect, it } from 'vitest'
import { getDb } from '#/db'
import { contatos, conversas, mensagens, negocios } from '#/db/schema'
import { createAuthHarness } from '#/test/auth-harness'
import { executarComando } from './carteira-escrita'
import { processarAviso } from './wa-avisos'
import { listarConversas } from './wa-conversas'

const credencial = {
  endereco: 'http://localhost:3233',
  token: 'teste',
  vinculo: 'cifra-da-linha',
}

it('importa chats individuais sem mensagens, respeita a atividade, a edição, a leitura e a exclusão da equipe', async () => {
  const h = await createAuthHarness()
  try {
    const {
      body: { user },
    } = await h.signIn('qa-chats@exemplo.test')
    const db = getDb(h.db)
    await h.db
      .prepare(
        "INSERT INTO numeros(id,nome,telefone,token_cifrado,setor_id,funil_padrao_id,cor,estado_em) VALUES('linha','Loja','5511991231234',?,'com','vendas','#123',1)",
      )
      .bind(credencial.vinculo)
      .run()
    const aviso = (dados: object) =>
      processarAviso(h.env, 'linha', credencial, dados)
    const cliente = {
      wa_chatid: '5511984213307@s.whatsapp.net',
      wa_chatlid: '010001@lid',
      wa_contactName: 'Clara',
      imagePreview: 'https://pps.whatsapp.net/miniatura.jpg?oe=F001',
      image: 'https://pps.whatsapp.net/grande.jpg',
      wa_unreadCount: 3,
      wa_lastMessageTextVote: 'Aguardando a proposta',
      wa_lastMessageType: 'Conversation',
      wa_lastMsgTimestamp: 1700000000,
    }
    const lote = {
      EventType: 'history',
      event: 'chats',
      request_id: 'pareamento',
      chats: [
        cliente,
        { ...cliente, wa_chatid: '551184213307@s.whatsapp.net' },
        {
          wa_chatid: 'identidade.09999888@lid',
          wa_name: 'Lia',
          wa_lastMessageType: 'StickerMessage',
          image: 'https://pps.whatsapp.net/lia.jpg',
          wa_lastMsgTimestamp: 1700000003000,
        },
        { wa_chatid: '991@g.us' },
        { wa_chatid: '991@newsletter' },
        { wa_chatid: 'status@broadcast' },
        { wa_chatid: '5511980012345@s.whatsapp.net', wa_isGroup: true },
        { wa_chatid: '551191231234@s.whatsapp.net' },
      ],
    }
    await aviso(lote)
    await aviso(lote)
    const lista = () => listarConversas(db, user.id)
    const linhas = (await lista()).lista
    expect(await db.select().from(contatos)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nome: 'Clara',
          fotoUrl: cliente.imagePreview,
        }),
        expect.objectContaining({
          nome: 'Lia',
          fotoUrl: 'https://pps.whatsapp.net/lia.jpg',
        }),
      ]),
    )
    expect(JSON.stringify(linhas)).not.toContain('pps.whatsapp.net')
    expect(linhas).toMatchObject([
      {
        nome: 'Lia',
        resumo: 'Figurinha',
        telefone: null,
        ultimaEm: new Date(1700000003000),
        naoLidas: 0,
      },
      {
        nome: 'Clara',
        resumo: 'Aguardando a proposta',
        telefone: '5511984213307',
        ultimaEm: new Date(1700000000000),
        naoLidas: 3,
      },
    ])
    expect(await db.select().from(conversas)).toMatchObject(
      expect.arrayContaining([
        expect.objectContaining({ lid: 'identidade.09999888@lid', jid: null }),
      ]),
    )
    expect(await db.select().from(mensagens)).toHaveLength(0)
    expect(await db.select().from(negocios)).toHaveLength(0)
    await aviso({
      EventType: 'history',
      event: 'messages',
      request_id: 'manual',
      messages: [
        {
          messageid: 'opaca',
          chatid: 'identidade.09999888@lid',
          messageTimestamp: 1699999900000,
          text: 'Anterior no LID',
        },
      ],
    })
    expect(await db.select().from(mensagens)).toMatchObject([
      { conversaId: linhas[0].id, texto: 'Anterior no LID' },
    ])
    const clara = linhas[1]
    expect(
      await executarComando(db, h.env.BUCKET, user.id, {
        tipo: 'editarContato',
        contatoId: clara.contatoId,
        nome: 'Nome da equipe',
        telefone: '5511984213307',
      }),
    ).toMatchObject({ ok: true })
    await aviso({
      EventType: 'messages',
      message: {
        messageid: 'agora',
        chatid: cliente.wa_chatid,
        messageTimestamp: 1700000010000,
        text: 'Oi',
      },
    })
    await aviso(lote)
    expect((await lista()).lista[0]).toMatchObject({
      nome: 'Nome da equipe',
      resumo: 'Oi',
      ultimaEm: new Date(1700000010000),
      naoLidas: 4,
    })
    const remover = async (contatoId: string, negocios: number) =>
      expect(
        await executarComando(db, h.env.BUCKET, user.id, {
          tipo: 'apagarContato',
          contatoId,
          conversas: 1,
          negocios,
        }),
      ).toMatchObject({ ok: true })
    await remover(clara.contatoId, 1)
    await remover(linhas[0].contatoId, 0)
    await aviso(lote)
    await aviso({
      EventType: 'history',
      event: 'messages',
      request_id: 'pareamento',
      messages: [
        {
          messageid: 'velha-ainda-nao-entregue',
          chatid: cliente.wa_chatid,
          messageTimestamp: 1700000005000,
          text: 'Anterior',
        },
        {
          messageid: 'salva-por-mim',
          chatid: '551191231234@s.whatsapp.net',
          messageTimestamp: 1700000003000,
          text: 'Eu',
        },
      ],
    })
    expect(await db.select().from(contatos)).toHaveLength(0)
  } finally {
    await h.dispose()
  }
})

it('aplica a primeira contagem do chat no instante de uma mensagem histórica e preserva leituras posteriores', async () => {
  const h = await createAuthHarness()
  try {
    const gestora = await h.signIn('qa-contagem@exemplo.test')
    const db = getDb(h.db)
    await h.db
      .prepare(
        "INSERT INTO numeros(id,nome,token_cifrado,setor_id,funil_padrao_id,cor,estado_em) VALUES('linha','Loja',?,'com','vendas','#123',1)",
      )
      .bind(credencial.vinculo)
      .run()
    const identidade = '551177778888@s.whatsapp.net'
    const instante = 1700000000000
    const processar = (dados: object) =>
      processarAviso(h.env, 'linha', credencial, dados)
    const mensagem = {
      messageid: 'antiga',
      chatid: identidade,
      messageTimestamp: instante,
      text: 'Oi',
    }
    const chat = {
      wa_chatid: identidade,
      wa_unreadCount: 3,
      wa_lastMsgTimestamp: instante,
    }
    const lote = { EventType: 'history', event: 'chats', chats: [chat] }
    await processar({
      EventType: 'history',
      event: 'messages',
      messages: [mensagem],
    })
    await processar(lote)
    const linha = () =>
      db
        .select({ id: conversas.id, naoLidas: conversas.naoLidas })
        .from(conversas)
        .get()
    const primeira = await linha()
    expect(primeira?.naoLidas).toBe(3)
    if (!primeira) throw new Error('Conversa ausente.')
    // A entrega ao vivo do que o contador do chat já cobriu não soma de novo.
    await processar({ EventType: 'messages', message: mensagem })
    expect((await linha())?.naoLidas).toBe(3)
    const { marcarLida } = await import('./wa-conversas')
    await marcarLida(db, gestora.body.user.id, primeira.id)
    await processar(lote)
    expect((await linha())?.naoLidas).toBe(0)
    await processar({
      EventType: 'messages',
      message: {
        ...mensagem,
        messageid: 'recente',
        messageTimestamp: instante + 2000,
      },
    })
    await processar({
      ...lote,
      chats: [
        { ...chat, wa_lastMsgTimestamp: instante + 1000, wa_unreadCount: 7 },
      ],
    })
    expect((await linha())?.naoLidas).toBe(1)
  } finally {
    await h.dispose()
  }
})

it('ignora o chat sem telefone e sem nome e mantém o que tem telefone', async () => {
  const { lerChatWa } = await import('./wa-chat-formato')
  expect(
    lerChatWa({ wa_chatid: '123456789012345@lid', name: '', wa_name: '' }),
  ).toBeNull()
  expect(
    lerChatWa({ wa_chatid: '5511984213307@s.whatsapp.net', name: '' }),
  ).toMatchObject({ telefone: '5511984213307' })
})

it('descarta reações e mostra o texto de botões e listas sem marcador', async () => {
  const { lerMensagem } = await import('./wa-avisos-formato')
  const base = {
    messageid: 'R1',
    chatid: '5511984213307@s.whatsapp.net',
    messageTimestamp: 1700000000000,
  }
  expect(
    lerMensagem({ ...base, messageType: 'ReactionMessage', text: '👍' }),
  ).toBeNull()
  expect(
    lerMensagem({
      ...base,
      messageType: 'ButtonsMessage',
      text: 'Escolha uma opção',
    }),
  ).toMatchObject({ texto: 'Escolha uma opção' })
})
