import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getDb } from '#/db'
import { contatos, conversas, mensagens, negocios, numeros } from '#/db/schema'
import { createAuthHarness } from '#/test/auth-harness'
import { gravarHistorico, processarAviso } from './wa-avisos'

const credencial = {
  endereco: 'http://localhost:3233',
  token: 'local',
  vinculo: 'cifra-da-linha',
}

let h: Awaited<ReturnType<typeof createAuthHarness>>
let gestor: string
const numero = 'loja'
const mensagem = {
  messageid: 'mensagem-um',
  messageTimestamp: 1700000000000,
  chatid: '5511977891234@s.whatsapp.net',
  text: 'Bom dia',
}
beforeEach(async () => {
  h = await createAuthHarness({
    UAZAPI_URL: 'http://localhost:3233',
    UAZAPI_CHAVE: btoa('t'.repeat(32)),
    UAZAPI_ADMIN_TOKEN: 'local',
  })
  gestor = (await h.signIn('gestao@exemplo.test')).body.user.id
  await getDb(h.db).insert(numeros).values({
    id: numero,
    nome: 'Loja',
    tokenCifrado: credencial.vinculo,
    setorId: 'com',
    funilPadraoId: 'vendas',
    cor: '#123',
  })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await h.dispose()
})

it('a reentrega de uma mensagem da queda conta uma não lida e abre o negócio mesmo depois do histórico', async () => {
  const db = getDb(h.db)
  await gravarHistorico(h.env, numero, credencial, [mensagem])
  expect(await db.select().from(conversas)).toMatchObject([{ naoLidas: 0 }])
  expect(await db.select().from(negocios)).toHaveLength(0)
  const aviso = { EventType: 'messages', message: mensagem }
  await processarAviso(h.env, numero, credencial, aviso)
  await processarAviso(h.env, numero, credencial, aviso)
  expect(await db.select().from(conversas)).toMatchObject([{ naoLidas: 1 }])
  expect(await db.select().from(negocios)).toMatchObject([{ etapaId: 'novo' }])
  expect(await db.select().from(mensagens)).toHaveLength(1)
})

it('o histórico e a reentrega preservam a exclusão e uma mensagem nova abre um atendimento', async () => {
  const db = getDb(h.db)
  await gravarHistorico(h.env, numero, credencial, [mensagem])
  // Uma mensagem anterior à 0010 ainda não tem a marca de reentrega.
  await db.update(mensagens).set({ marcaReentrega: null })
  const [contato] = await db.select().from(contatos)
  const { executarComando } = await import('./carteira-escrita')
  const apagado = await executarComando(db, h.env.BUCKET, gestor, {
    tipo: 'apagarContato',
    contatoId: contato.id,
    conversas: 1,
    negocios: 0,
  })
  expect(apagado.ok).toBe(true)
  await gravarHistorico(h.env, numero, credencial, [mensagem])
  await processarAviso(h.env, numero, credencial, {
    EventType: 'messages',
    message: mensagem,
  })
  expect(await db.select().from(contatos)).toHaveLength(0)
  await processarAviso(h.env, numero, credencial, {
    EventType: 'messages',
    message: { ...mensagem, messageid: 'nova' },
  })
  expect(await db.select().from(mensagens)).toMatchObject([
    { identificador: 'nova' },
  ])
})

it('uma mídia indisponível deixa uma cópia para retomar e permite importar o número seguinte', async () => {
  const { adicionarNumeros } = await import('./wa-numeros-gestao')
  const { avisosPendentes } = await import('#/db/schema')
  const db = getDb(h.db)
  const instancias = ['primeira', 'segunda'].map((id) => ({
    id,
    name: id,
    token: id,
    status: 'connected',
  }))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname
    if (path === '/instance/all') return Response.json(instancias)
    if (path === '/webhook') return Response.json({})
    if (path === '/message/download') return new Response(null, { status: 503 })
    if (path === '/chat/find')
      return Response.json({ chats: [], pagination: { hasMore: false } })
    if (path === '/message/find') {
      const primeira = new Headers(init?.headers).get('token') === 'primeira'
      return Response.json({
        messages: primeira
          ? [{ ...mensagem, messageType: 'DocumentMessage' }]
          : [{ ...mensagem, messageid: 'segunda' }],
        pagination: { hasMore: false },
      })
    }
    throw new Error('Rota inesperada.')
  })
  await adicionarNumeros(
    h.env,
    gestor,
    'http://localhost:3280',
    instancias.map((i) => ({
      instanciaId: i.id,
      setorId: 'com',
      funilId: 'vendas',
    })),
  )
  expect(
    (await db.select().from(numeros)).filter((n) => n.estado === 'conectado'),
  ).toHaveLength(2)
  expect(await db.select().from(mensagens)).toHaveLength(2)
  expect(await db.select().from(avisosPendentes)).toHaveLength(1)
})

it('apagar um contato durante a cópia de mídia também expurga a chave recém-gravada', async () => {
  const db = getDb(h.db)
  const { executarComando } = await import('./carteira-escrita')
  const bucket = h.env.BUCKET
  const env = {
    ...h.env,
    BUCKET: new Proxy(bucket, {
      get(alvo, campo) {
        if (campo === 'put')
          return async (...args: Parameters<R2Bucket['put']>) => {
            const salvo = await alvo.put(...args)
            const [contato] = await db.select().from(contatos)
            const resultado = await executarComando(db, bucket, gestor, {
              tipo: 'apagarContato',
              contatoId: contato.id,
              conversas: 1,
              negocios: 0,
            })
            expect(resultado.ok).toBe(true)
            return salvo
          }
        const metodo = Reflect.get(alvo, campo)
        return typeof metodo === 'function' ? metodo.bind(alvo) : metodo
      },
    }),
  }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
    String(url).endsWith('/message/download')
      ? Response.json({ fileURL: `${h.env.UAZAPI_URL}/arquivo` })
      : new Response('arquivo'),
  )
  await gravarHistorico(env, numero, credencial, [
    { ...mensagem, messageType: 'DocumentMessage' },
  ])
  expect(await db.select().from(contatos)).toHaveLength(0)
  expect((await bucket.list()).objects).toHaveLength(0)
})

it('a reconciliação recupera a leitura da mensagem enviada pelo aparelho sem regredir depois', async () => {
  const enviada = { ...mensagem, fromMe: true, status: 'Sent' }
  await processarAviso(h.env, numero, credencial, {
    EventType: 'messages',
    message: enviada,
  })
  await gravarHistorico(h.env, numero, credencial, [
    { ...enviada, status: 'Read' },
  ])
  await gravarHistorico(h.env, numero, credencial, [enviada])
  expect(await getDb(h.db).select().from(mensagens)).toMatchObject([
    { estado: 'lida' },
  ])
})

it('completa a mensagem antiga no histórico sem duplicar, contar como nova ou regredir a entrega', async () => {
  const { lerChat, listarConversas } = await import('./wa-conversas')
  const { importarChats } = await import('./wa-chats')
  const db = getDb(h.db)
  const antiga = {
    ...mensagem,
    fromMe: true,
    status: 'Read',
    text: 'Mensagem não suportada',
  }
  await gravarHistorico(h.env, numero, credencial, [antiga])
  const [original] = await db.select().from(mensagens)
  const completa = {
    ...mensagem,
    fromMe: true,
    status: 'Sent',
    text: '',
    messageType: 'ButtonsMessage',
    content: {
      contentText: 'Como quer pagar?',
      buttons: [{ buttonText: { displayText: 'Pix' } }],
    },
  }
  await importarChats(h.env, numero, credencial, [
    {
      wa_chatid: mensagem.chatid,
      wa_lastMsgTimestamp: mensagem.messageTimestamp,
      wa_lastMessageType: 'ButtonsMessage',
    },
  ])
  for (const entrega of [completa, completa, antiga]) {
    expect(await gravarHistorico(h.env, numero, credencial, [entrega])).toBe(0)
  }
  expect(await lerChat(db, gestor, original.conversaId)).toMatchObject([
    {
      id: original.id,
      texto: 'Como quer pagar?',
      estado: 'lida',
      interativa: { opcoes: [{ rotulo: 'Pix', tipo: 'resposta' }] },
    },
  ])
  expect((await listarConversas(db, gestor)).lista[0].resumo).toBe(
    'Como quer pagar?',
  )

  const resposta = {
    ...mensagem,
    messageid: 'escolha',
    messageTimestamp: mensagem.messageTimestamp + 1000,
    messageType: 'ButtonsResponseMessage',
    text: '',
  }
  await gravarHistorico(h.env, numero, credencial, [resposta])
  await processarAviso(h.env, numero, credencial, {
    EventType: 'history',
    event: 'messages',
    messages: [{ ...resposta, vote: 'Pix' }],
  })
  await importarChats(h.env, numero, credencial, [
    {
      wa_chatid: mensagem.chatid,
      wa_lastMsgTimestamp: resposta.messageTimestamp,
      wa_lastMessageType: resposta.messageType,
    },
  ])
  expect(await lerChat(db, gestor, original.conversaId)).toMatchObject([
    { id: original.id },
    { texto: 'Pix' },
  ])
  expect((await listarConversas(db, gestor)).lista[0].resumo).toBe('Pix')
})

it.each(['declarado', 'em partes'])(
  'recusa a mídia recebida acima de 8 MiB (%s) sem repetir a cópia',
  async (modo) => {
    const arquivo = { ...mensagem, messageType: 'DocumentMessage' }
    let downloads = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).endsWith('/message/download')) {
        downloads++
        return Response.json({ fileURL: `${h.env.UAZAPI_URL}/arquivo` })
      }
      let partes = 8
      const corpo = new ReadableStream<Uint8Array>({
        pull(c) {
          if (partes-- > 0) c.enqueue(new Uint8Array(1024 * 1024))
          else {
            c.enqueue(new Uint8Array(1))
            c.close()
          }
        },
      })
      return new Response(corpo, {
        headers:
          modo === 'declarado'
            ? { 'content-length': String(8 * 1024 * 1024 + 1) }
            : {},
      })
    })
    await gravarHistorico(h.env, numero, credencial, [arquivo])
    await gravarHistorico(h.env, numero, credencial, [arquivo])
    const { avisosPendentes, arquivosEmExclusao } = await import('#/db/schema')
    const db = getDb(h.db)
    expect(await db.select().from(mensagens)).toMatchObject([
      { midiaRecusada: true, arquivoChave: null },
    ])
    expect((await h.env.BUCKET.list()).objects).toHaveLength(0)
    expect(await db.select().from(avisosPendentes)).toHaveLength(0)
    expect(await db.select().from(arquivosEmExclusao)).toHaveLength(0)
    expect(downloads).toBe(1)
  },
)

it.each([400, 404])(
  'a recusa %i de /message/download encerra a cópia da mídia',
  async (status) => {
    const { avisosPendentes } = await import('#/db/schema')
    const db = getDb(h.db)
    const rede = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url) => {
        expect(new URL(String(url)).pathname).toBe('/message/download')
        return new Response(null, { status })
      })
    const foto = { ...mensagem, messageType: 'ImageMessage' }
    await gravarHistorico(h.env, numero, credencial, [foto])
    expect(await db.select().from(mensagens)).toMatchObject([
      { midiaRecusada: true, arquivoChave: null },
    ])
    expect(await db.select().from(avisosPendentes)).toEqual([])
    await processarAviso(h.env, numero, credencial, {
      EventType: 'messages',
      message: foto,
    })
    expect(rede).toHaveBeenCalledTimes(1)
  },
)

it('vídeo, figurinha e formato desconhecido aparecem no chat sem baixar o arquivo', async () => {
  const { lerChat } = await import('./wa-conversas')
  const rede = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Download inesperado'))
  const recebidas = ['VideoMessage', 'StickerMessage', 'FormatoFuturo'].map(
    (messageType, i) => ({
      ...mensagem,
      messageid: messageType,
      messageType,
      messageTimestamp: mensagem.messageTimestamp + i,
      text: i === 0 ? 'Veja o acabamento' : '',
    }),
  )
  await gravarHistorico(h.env, numero, credencial, recebidas)
  for (const message of recebidas) {
    await processarAviso(h.env, numero, credencial, {
      EventType: 'messages',
      message,
    })
  }
  const [conversa] = await getDb(h.db).select().from(conversas)
  expect(conversa).toBeDefined()
  expect(await lerChat(getDb(h.db), gestor, conversa.id)).toMatchObject([
    {
      tipo: 'texto',
      texto: 'Vídeo recebido. Abra no WhatsApp para ver.\nVeja o acabamento',
    },
    { tipo: 'texto', texto: 'Figurinha' },
    { tipo: 'texto', texto: 'Mensagem não suportada' },
  ])
  expect(rede).not.toHaveBeenCalled()
})

it('percorre os chats em páginas limitadas e retoma ambos os índices depois da interrupção', async () => {
  const { reconciliarNumero } = await import('./wa-numeros-historico')
  const offsetsChats: number[] = []
  const offsetsMensagens: number[] = []
  const chat = (i: number) => ({
    wa_chatid: `551198421${String(i).padStart(4, '0')}@s.whatsapp.net`,
    name: `Pessoa ${i}`,
  })
  let interromper = true
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const rota = new URL(String(input)).pathname
    const busca = JSON.parse(String(init?.body ?? '{}'))
    if (rota === '/webhook/errors') return Response.json([])
    if (rota === '/chat/find') {
      offsetsChats.push(busca.offset)
      expect(busca.compact).toBe(true)
      expect(busca.limit).toBeLessThanOrEqual(200)
      return Response.json({
        chats: [chat(busca.offset)],
        pagination: { hasMore: busca.offset === 0, nextOffset: 1 },
      })
    }
    if (rota === '/message/find') {
      offsetsMensagens.push(busca.offset)
      if (interromper) return new Response(null, { status: 503 })
      return Response.json({
        messages: [mensagem],
        pagination: { hasMore: false },
      })
    }
    throw new Error('Rota inesperada.')
  })
  await expect(reconciliarNumero(h.env, numero, credencial)).rejects.toThrow()
  expect(offsetsChats).toEqual([0])
  interromper = false
  const fim = await reconciliarNumero(h.env, numero, credencial)
  expect(fim).toMatchObject({ pendente: false })
  expect(offsetsChats).toEqual([0, 1])
  expect(offsetsMensagens).toEqual([0, 0])
  expect(await getDb(h.db).select().from(conversas)).toHaveLength(3)
})

it('mantém a varredura com 100 chats, falha de entrega e mídia multipart dentro da cota por execução', async () => {
  const { reconciliarNumero } = await import('./wa-numeros-historico')
  const { medirFila } = await import('#/test/d1-fila')
  const operacoesR2: string[] = []
  const bucket = h.env.BUCKET
  const env = {
    ...h.env,
    BUCKET: new Proxy(bucket, {
      get(alvo, campo) {
        if (campo === 'createMultipartUpload')
          return async (
            ...args: Parameters<R2Bucket['createMultipartUpload']>
          ) => {
            operacoesR2.push(String(campo))
            const upload = await alvo.createMultipartUpload(...args)
            return new Proxy(upload, {
              get(obj, chave) {
                const metodo = Reflect.get(obj, chave)
                if (typeof metodo !== 'function') return metodo
                return (...args: unknown[]) => {
                  operacoesR2.push(String(chave))
                  return metodo.apply(obj, args)
                }
              },
            })
          }
        const metodo = Reflect.get(alvo, campo)
        return typeof metodo === 'function' ? metodo.bind(alvo) : metodo
      },
    }),
  }
  const midia = { ...mensagem, messageType: 'DocumentMessage' }
  const chamadas: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const rota = new URL(String(input)).pathname
    chamadas.push(rota)
    if (rota === '/webhook/errors')
      return Response.json([{ event: 'messages', messageid: midia.messageid }])
    if (rota === '/chat/find') {
      const chats = Array.from({ length: 100 }, (_, i) => ({
        wa_chatid: `551198728${String(i).padStart(4, '0')}@s.whatsapp.net`,
      }))
      return Response.json({ chats, pagination: { hasMore: false } })
    }
    if (rota === '/message/find') {
      const { id, offset } = JSON.parse(String(init?.body))
      return Response.json({
        messages: id
          ? [midia]
          : [midia, { ...midia, messageid: 'outra-midia' }].slice(offset),
        pagination: { hasMore: false },
      })
    }
    if (rota === '/message/download')
      return Response.json({ fileURL: `${credencial.endereco}/arquivo` })
    if (rota === '/arquivo')
      return new Response(new Uint8Array(6 * 1024 * 1024))
    throw new Error('Rota inesperada.')
  })
  const medir = () =>
    medirFila(h.db, () => reconciliarNumero(env, numero, credencial), 0)
  const primeira = await medir()
  const sql = primeira.consultas.reduce(
    (s, q) => s + Number(/^batch\((\d+)\)/.exec(q)?.[1] ?? 1),
    0,
  )
  expect(primeira.resultado).toEqual({
    chats: 100,
    mensagens: 1,
    pendente: true,
  })
  expect(chamadas).toHaveLength(5)
  expect(operacoesR2).toEqual([
    'createMultipartUpload',
    'uploadPart',
    'uploadPart',
    'complete',
  ])
  expect(sql).toBeLessThanOrEqual(27)
  expect(primeira.total).toBeLessThanOrEqual(12)
  const segunda = await medir()
  // Só a primeira mídia da página coube nesta invocação.
  expect(segunda.resultado.pendente).toBe(true)
  expect((await medir()).resultado).toEqual({
    chats: 100,
    mensagens: 2,
    pendente: false,
  })
  console.info(
    `[c5] 100 chats, falha, mídia de 6 MiB: D1=${primeira.total} idas/${sql} instruções; HTTP=5; R2=4`,
  )
})
it('a sincronização do cartão exige gestor e devolve as contagens do número já conectado sem novo pareamento', async () => {
  const { sincronizarConversas } = await import('./wa-numeros-gestao')
  const { cifrarToken } = await import('./uazapi')
  const { eq } = await import('drizzle-orm')
  const db = getDb(h.db)
  await db
    .update(numeros)
    .set({
      estado: 'conectado',
      estadoEm: new Date(),
      tokenCifrado: await cifrarToken(h.env.UAZAPI_CHAVE, 'local'),
    })
    .where(eq(numeros.id, numero))
  const vendedor = (await h.signIn('equipe@exemplo.test')).body.user.id
  const rede = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (entrada) => {
      switch (new URL(String(entrada)).pathname) {
        case '/webhook/errors':
          return Response.json([])
        case '/chat/find':
          return Response.json({
            chats: [
              {
                wa_chatid: '5511990022211@s.whatsapp.net',
                name: 'Sem mensagens',
              },
            ],
            pagination: { hasMore: false },
          })
        case '/message/find':
          return Response.json({
            messages: [mensagem],
            pagination: { hasMore: false },
          })
        default:
          throw new Error('Rota inesperada.')
      }
    })
  await expect(sincronizarConversas(h.env, vendedor, numero)).rejects.toThrow(
    'Sem acesso',
  )
  expect(rede).not.toHaveBeenCalled()
  expect(await sincronizarConversas(h.env, gestor, numero)).toEqual({
    chats: 1,
    mensagens: 1,
    pendente: false,
  })
  expect(await sincronizarConversas(h.env, gestor, numero)).toEqual({
    chats: 1,
    mensagens: 0,
    pendente: false,
  })
  expect(await db.select().from(conversas)).toHaveLength(2)
})
