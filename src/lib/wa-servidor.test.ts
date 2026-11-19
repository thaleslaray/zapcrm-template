import { expect, test, vi } from 'vitest'
import { getDb } from '#/db'
import { currentD1Session } from '#/db/d1-session'
import { rastrearD1 } from '#/db/d1-trace'
import { contatos, conversas, mensagens, numeros } from '#/db/schema'
import { createAuthHarness } from '#/test/auth-harness'
import { medirFila } from '#/test/d1-fila'
import { type AuditRecord, onAudit } from './audit'
import { linhaDeDesempenho } from './perf-log'
import { decifrarToken } from './uazapi'
import {
  estadoServidor,
  normalizarEndereco,
  obterServidor,
  removerServidor,
  salvarServidor,
} from './wa-servidor'

test('uma gestora testa, cifra e audita o servidor antes que ele substitua os segredos locais', async () => {
  const h = await createAuthHarness({
    UAZAPI_URL: 'https://legado.exemplo.test',
    UAZAPI_ADMIN_TOKEN: 'legado-ficticio',
    UAZAPI_CHAVE: btoa('x'.repeat(32)),
  })
  const eventos: AuditRecord[] = []
  const parar = onAudit('teste-servidor', async (evento) => {
    eventos.push(evento)
  })
  try {
    const { user: gestora } = (await h.signIn('gestora@exemplo.test')).body
    const { user: vendedor } = (await h.signIn('vendedor@exemplo.test')).body
    await h.db
      .prepare("UPDATE user SET name='Ana Gestora' WHERE id=?")
      .bind(gestora.id)
      .run()
    const pedido = {
      endereco: 'https://NOVO.exemplo.test/api?privado=1',
      token: 'credencial-de-teste',
    }
    const rede = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json([]))
    for (const tentar of [
      () => estadoServidor(h.env, vendedor.id),
      () => salvarServidor(h.env, vendedor.id, pedido),
      () => removerServidor(h.env, vendedor.id, { confirmar: true }),
    ])
      await expect(tentar()).rejects.toThrow('Sem acesso')
    expect(rede).not.toHaveBeenCalled()

    expect(await estadoServidor(h.env, gestora.id)).toEqual({
      configurado: true,
      host: 'legado.exemplo.test',
      salvoEm: null,
      salvoPor: null,
    })
    const logs = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
    ]
    const rastreio = rastrearD1(
      h.db.withSession('first-primary'),
      'salvar servidor',
    )
    const ambiente = { ...h.env, DB: rastreio.sessao as unknown as D1Database }
    expect(await salvarServidor(ambiente, gestora.id, pedido)).toEqual({
      confirmacaoNecessaria: false,
    })
    const [destino, opcoes] = rede.mock.calls[0]
    expect(String(destino)).toBe('https://novo.exemplo.test/instance/all')
    expect(opcoes?.redirect).toBe('manual')
    expect(new Headers(opcoes?.headers).get('admintoken')).toBe(pedido.token)
    const db = getDb(h.db)
    expect(await obterServidor(db, h.env)).toMatchObject({
      endereco: 'https://novo.exemplo.test',
      token: pedido.token,
    })
    const cifra = await h.db
      .prepare('SELECT token_cifrado FROM servidor_uazapi')
      .first<string>('token_cifrado')
    if (!cifra) throw new Error('Credencial não gravada no D1.')
    expect(cifra).toMatch(/^v1\./)
    expect(await decifrarToken(h.env.UAZAPI_CHAVE, cifra)).toBe(pedido.token)
    const atual = await estadoServidor(h.env, gestora.id)
    expect(atual).toEqual({
      configurado: true,
      host: 'novo.exemplo.test',
      salvoEm: expect.any(Number),
      salvoPor: 'Ana Gestora',
    })
    const segredos = [pedido.token, h.env.UAZAPI_ADMIN_TOKEN, cifra]
    for (const [status, erro] of [
      [401, 'Token de administração recusado'],
      [403, 'Token de administração recusado'],
      [301, 'Servidor uazapi não respondeu'],
      [500, 'Servidor uazapi não respondeu'],
    ] as const) {
      rede.mockResolvedValueOnce(new Response(pedido.token, { status }))
      await expect(
        salvarServidor(h.env, gestora.id, { ...pedido, token: 'outro' }),
      ).rejects.toThrow(erro)
    }
    rede.mockRejectedValueOnce(new Error(pedido.token))
    await expect(salvarServidor(h.env, gestora.id, pedido)).rejects.toThrow(
      /^Servidor uazapi não respondeu\./,
    )
    expect(await estadoServidor(h.env, gestora.id)).toEqual(atual)
    expect(
      await removerServidor(h.env, gestora.id, { confirmar: true }),
    ).toEqual({ confirmacaoNecessaria: false })
    expect((await obterServidor(db, h.env)).endereco).toBe(h.env.UAZAPI_URL)
    expect(
      eventos
        .filter((e) => e.targetType === 'servidor_uazapi')
        .map((e) => e.action),
    ).toEqual(['uazapi.servidor_salvo', 'uazapi.servidor_removido'])
    const perf = linhaDeDesempenho({
      method: 'POST',
      url: 'https://crm.exemplo.test/_serverFn/salvar',
      status: 200,
      ms: 20,
      idas: rastreio.idas(),
    })
    expect(rastreio.idas().length).toBeGreaterThan(0)
    for (const segredo of segredos)
      expect(
        JSON.stringify([
          eventos,
          atual,
          perf,
          logs.map((spy) => spy.mock.calls),
        ]),
      ).not.toContain(segredo)
  } finally {
    parar()
    vi.restoreAllMocks()
    await h.dispose()
  }
})

test('endereço aceita origem pública HTTPS e reserva HTTP de loopback para o desenvolvimento', () => {
  expect(
    normalizarEndereco(
      ' https://PUBLICO.exemplo.test:443/caminho?teste=1#secao ',
      false,
    ),
  ).toBe('https://publico.exemplo.test')
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    expect(normalizarEndereco(`http://${host}:3233`, true)).toBe(
      `http://${host}:3233`,
    )
    expect(() => normalizarEndereco(`http://${host}:3233`, false)).toThrow(
      'Endereço do servidor inválido',
    )
  }
  for (const entrada of [
    'https://usuario:senha@publico.test',
    'https://@publico.test',
    'http://publico.test',
    'file:///caminho',
    'https://10.2.3.4',
    'https://172.31.255.255',
    'https://192.168.1.1',
    'https://169.254.1.1',
    'https://127.5.0.2',
    'https://0x7f000001',
    'https://2130706433',
    'https://[fe80::c]',
    'https://[fc00::c]',
    'https://[fd10::c]',
    'https://[::ffff:7f00:1]',
    'https://[::]',
    'https://lo\ncal.exemplo.test',
  ])
    expect(() => normalizarEndereco(entrada, false), entrada).toThrow(
      'Endereço do servidor inválido',
    )
})

test('a troca de origem e a remoção só desligam os números com confirmação e preservam o histórico', async () => {
  const h = await createAuthHarness({
    UAZAPI_URL: 'https://legado.exemplo.test',
    UAZAPI_ADMIN_TOKEN: 'antigo',
    UAZAPI_CHAVE: btoa('k'.repeat(32)),
  })
  try {
    const id = (await h.signIn('gestora@exemplo.test')).body.user.id
    const db = getDb(h.db)
    const novo = {
      endereco: 'https://novo.exemplo.test',
      token: 'credencial-nova',
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json([]),
    )
    await db.insert(numeros).values({
      id: 'linha',
      nome: 'Comercial',
      cor: '#123',
      setorId: 'com',
      funilPadraoId: 'vendas',
      estado: 'conectado',
      estadoEm: new Date(),
      tokenCifrado: 'antigo-cifrado',
      segredoWebhookHash: 'hash-anterior',
      instanciaId: 'remota',
      sincronizandoHistorico: true,
    })
    await db.insert(contatos).values({ id: 'cliente', nome: 'Maria' })
    await db
      .insert(conversas)
      .values({ id: 'conversa', contatoId: 'cliente', numeroId: 'linha' })
    await db.insert(mensagens).values({
      id: 'msg',
      numeroId: 'linha',
      conversaId: 'conversa',
      direcao: 'recebida',
      estado: 'entregue',
      tipo: 'texto',
      texto: 'Conversa preservada',
      instante: new Date(),
    })
    expect(await salvarServidor(h.env, id, novo)).toEqual({
      confirmacaoNecessaria: true,
    })
    expect((await estadoServidor(h.env, id)).host).toBe('legado.exemplo.test')
    const linha = async () => (await db.select().from(numeros))[0]
    expect(await linha()).toMatchObject({
      estado: 'conectado',
      tokenCifrado: 'antigo-cifrado',
    })
    // A rotação apenas do token administrativo preserva a conexão.
    expect(
      await salvarServidor(h.env, id, {
        ...novo,
        endereco: 'https://legado.exemplo.test/nova-rota',
      }),
    ).toEqual({ confirmacaoNecessaria: false })
    expect((await linha()).estado).toBe('conectado')
    expect(
      await salvarServidor(h.env, id, { ...novo, confirmar: true }),
    ).toEqual({ confirmacaoNecessaria: false })
    expect(await linha()).toMatchObject({
      id: 'linha',
      estado: 'desconectado',
      instanciaId: null,
      tokenCifrado: null,
      segredoWebhookHash: null,
      sincronizandoHistorico: false,
    })
    expect(await removerServidor(h.env, id, {})).toEqual({
      confirmacaoNecessaria: true,
    })
    expect((await estadoServidor(h.env, id)).host).toBe('novo.exemplo.test')
    await db
      .update(numeros)
      .set({ estado: 'conectado', tokenCifrado: 'reconectado' })
    await removerServidor(h.env, id, { confirmar: true })
    expect(await linha()).toMatchObject({
      id: 'linha',
      estado: 'desconectado',
      tokenCifrado: null,
    })
    expect((await db.select().from(mensagens))[0]).toMatchObject({
      conversaId: 'conversa',
      texto: 'Conversa preservada',
    })
    expect((await db.select().from(conversas))[0].contatoId).toBe('cliente')
    expect((await db.select().from(contatos))[0].nome).toBe('Maria')
  } finally {
    vi.restoreAllMocks()
    await h.dispose()
  }
})

test('sem cadastro e sem par de segredos a instalação exibe o estado vazio em uma ida ao D1', async () => {
  const h = await createAuthHarness({
    UAZAPI_ADMIN_TOKEN: '',
    UAZAPI_URL: 'http://localhost:3233',
  })
  try {
    const id = (await h.signIn('gestora@exemplo.test')).body.user.id
    // Entrega ao código que exige o primário o mesmo D1 instrumentado pelo medidor.
    const medida = await medirFila(h.db, () =>
      estadoServidor(
        { ...h.env, DB: currentD1Session() as unknown as D1Database },
        id,
      ),
    )
    expect(medida).toMatchObject({
      filaMax: 1,
      total: 1,
      resultado: {
        configurado: false,
        host: null,
        salvoPor: null,
        salvoEm: null,
      },
    })
    await expect(obterServidor(getDb(h.db), h.env)).rejects.toThrow(
      'Servidor uazapi não configurado.',
    )
  } finally {
    await h.dispose()
  }
})

test('o cadastro recusa troca de papel durante a prova externa e a remoção exige confirmação mesmo sem números', async () => {
  const h = await createAuthHarness({ UAZAPI_CHAVE: btoa('k'.repeat(32)) })
  try {
    const id = (await h.signIn('gestora@exemplo.test')).body.user.id
    const db = getDb(h.db)
    const substituta = (await h.signIn('outra-gestora@exemplo.test')).body.user
      .id
    await h.db
      .prepare("UPDATE pessoas SET papel='gestor' WHERE usuario_id=?")
      .bind(substituta)
      .run()
    const pedido = { endereco: 'https://novo.exemplo.test', token: 'primeira' }
    const rede = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json([]))
    await expect(
      salvarServidor(h.env, id, { ...pedido, token: 'in\nvalido' }),
    ).rejects.toThrow('Informe o token')
    expect(rede).not.toHaveBeenCalled()
    await salvarServidor(h.env, id, pedido)
    expect(await removerServidor(h.env, id, {})).toEqual({
      confirmacaoNecessaria: true,
    })
    const antes = await obterServidor(db, h.env)
    rede.mockImplementationOnce(async () => {
      await h.db
        .prepare("UPDATE pessoas SET papel='vendedor' WHERE usuario_id=?")
        .bind(id)
        .run()
      return Response.json([])
    })
    await expect(
      salvarServidor(h.env, id, {
        ...pedido,
        token: 'recusada',
        confirmar: true,
      }),
    ).rejects.toThrow('Sem acesso')
    expect(await obterServidor(db, h.env)).toEqual(antes)
  } finally {
    vi.restoreAllMocks()
    await h.dispose()
  }
})

test('remover o servidor conclui localmente mensagens aceitas, inclusive metadados de mídia e recibos antecipados', async () => {
  const { avisosPendentes, conversas, mensagens, numeros, recibosPendentes } =
    await import('#/db/schema')
  const { lerAviso } = await import('./wa-avisos-formato')
  const h = await createAuthHarness({ UAZAPI_CHAVE: btoa('k'.repeat(32)) })
  try {
    const gestora = (await h.signIn('gestora@exemplo.test')).body.user.id
    const db = getDb(h.db)
    const rede = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json([]))
    await salvarServidor(h.env, gestora, {
      endereco: 'https://antigo.example',
      token: 'local',
    })
    const { cifrarToken } = await import('./uazapi')
    await db.insert(numeros).values({
      id: 'loja',
      nome: 'Loja',
      cor: '#123',
      setorId: 'com',
      funilPadraoId: 'vendas',
      estado: 'conectado',
      historicoPedido: 'pareamento-local',
      estadoEm: new Date(),
      tokenCifrado: await cifrarToken(h.env.UAZAPI_CHAVE, 'local'),
    })
    const base = {
      chatid: '5511977891234@s.whatsapp.net',
      messageTimestamp: 1700000000000,
    }
    // Simula a interrupção do Worker após confirmar o ingresso no D1.
    const eventos = [
      {
        EventType: 'messages',
        message: {
          ...base,
          messageid: 'chegou',
          text: 'Preciso de uma proposta',
        },
      },
      {
        EventType: 'history',
        event: 'messages',
        request_id: 'pareamento-local',
        messages: [
          {
            ...base,
            messageid: 'anexo',
            text: 'Proposta',
            fromMe: true,
            messageType: 'DocumentMessage',
            content: { fileName: 'proposta.pdf' },
          },
        ],
      },
      {
        EventType: 'messages_update',
        type: 'ReadReceipt',
        state: 'Read',
        event: { MessageIDs: ['outra'] },
      },
      {
        EventType: 'messages',
        message: {
          ...base,
          messageid: 'outra',
          fromMe: true,
          text: 'Entendido',
        },
      },
    ]
    // Quatro tarefas de conteúdo acima e mais dezessete ultrapassam por uma
    // o limite de consolidação por pedido. O aviso de carga é só do vínculo.
    for (let i = 0; i < 17; i++)
      eventos.push({
        EventType: 'messages',
        message: {
          ...base,
          messageid: `lote-${i}`,
          text: 'Confirmado',
          fromMe: true,
        },
      })
    for (const a of eventos.flatMap(lerAviso)) {
      await db.insert(avisosPendentes).values({
        id: crypto.randomUUID(),
        numeroId: 'loja',
        conteudo: JSON.stringify(a),
      })
    }
    await db
      .insert(recibosPendentes)
      .values({ numeroId: 'loja', identificador: 'anexo', nivel: 2 })
    await salvarServidor(h.env, gestora, {
      endereco: 'https://antigo.example',
      token: 'substituido',
      confirmar: true,
    })
    expect(await removerServidor(h.env, gestora, { confirmar: false })).toEqual(
      { confirmacaoNecessaria: true },
    )
    expect(await db.select().from(mensagens)).toHaveLength(0)
    expect(await db.select().from(avisosPendentes)).toHaveLength(22)
    rede
      .mockClear()
      .mockRejectedValue(new Error('Servidor removido fora do ar'))
    await expect(
      removerServidor(h.env, gestora, { confirmar: true }),
    ).rejects.toThrow('Repita a operação')
    expect((await estadoServidor(h.env, gestora)).configurado).toBe(true)
    expect((await db.select().from(numeros))[0].estado).toBe('conectado')
    expect(await db.select().from(avisosPendentes)).toHaveLength(22)
    expect(await removerServidor(h.env, gestora, { confirmar: true })).toEqual({
      confirmacaoNecessaria: false,
    })
    expect(await db.select().from(mensagens)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          identificador: 'chegou',
          texto: 'Preciso de uma proposta',
        }),
        expect.objectContaining({
          identificador: 'anexo',
          texto: 'Proposta',
          arquivoNome: 'proposta.pdf',
          estado: 'entregue',
          arquivoChave: null,
        }),
        expect.objectContaining({ identificador: 'outra', estado: 'lida' }),
      ]),
    )
    expect(await db.select().from(mensagens)).toHaveLength(20)
    expect(await db.select().from(conversas)).toMatchObject([{ naoLidas: 1 }])
    expect(await db.select().from(avisosPendentes)).toHaveLength(0)
    expect(await db.select().from(recibosPendentes)).toHaveLength(0)
    expect(await db.select().from(numeros)).toMatchObject([
      { id: 'loja', estado: 'desconectado', tokenCifrado: null },
    ])
    expect(rede).not.toHaveBeenCalled()
  } finally {
    vi.restoreAllMocks()
    await h.dispose()
  }
})
