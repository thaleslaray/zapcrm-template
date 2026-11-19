import { expect, test, vi } from 'vitest'
import { createAuthHarness } from '#/test/auth-harness'
import { catalogoDoGestor } from './wa-numeros'

test('só a gestora vê o catálogo e recebe apenas os dados públicos das instâncias', async () => {
  const h = await createAuthHarness()
  try {
    const gestora = await h.signIn('gestora@exemplo.test')
    const vendedor = await h.signIn('vendedor@exemplo.test')
    const instancia = {
      id: 'instancia-um',
      name: 'Comercial',
      status: 'connected',
      owner: '551140028922',
      token: 'token-de-controle',
      adminField02: 'informação privada',
    }
    const chamadas = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json([
          instancia,
          null,
          { ...instancia, token: '' },
          { ...instancia, id: 'futura', status: 'futuro' },
        ]),
      )
    const env = Object.assign(h.env, {
      UAZAPI_URL: 'http://localhost:3233',
      UAZAPI_ADMIN_TOKEN: 'admin-ficticio',
    })
    await expect(catalogoDoGestor(env, vendedor.body.user.id)).rejects.toThrow(
      'Sem acesso',
    )
    expect(chamadas).not.toHaveBeenCalled()
    expect(await catalogoDoGestor(env, gestora.body.user.id)).toEqual([
      {
        id: 'instancia-um',
        nome: 'Comercial',
        estado: 'conectado',
        telefone: '551140028922',
        adicionada: false,
      },
      {
        id: 'futura',
        nome: 'Comercial',
        estado: 'desconectado',
        telefone: '551140028922',
        adicionada: false,
      },
    ])
  } finally {
    vi.restoreAllMocks()
    await h.dispose()
  }
})

test('a gestão recupera criação e pareamento interrompidos, acompanha queda sem aviso e troca o segredo ao reconectar', async () => {
  const h = await createAuthHarness()
  try {
    const {
      criarNumero,
      conectarNumero,
      consultarPareamento,
      desconectarNumero,
    } = await import('./wa-numeros-gestao')
    const { painelDoGestor } = await import('./wa-numeros')
    const gestora = (await h.signIn('gestao@exemplo.test')).body.user.id
    const env = Object.assign(h.env, {
      UAZAPI_URL: 'http://localhost:3233',
      UAZAPI_CHAVE: btoa('k'.repeat(32)),
      UAZAPI_ADMIN_TOKEN: 'local',
    })
    const pedido = {
      id: crypto.randomUUID(),
      nome: 'Solar',
      setorId: 'com',
      funilId: 'vendas',
      dias: 180,
    }
    const orig = 'http://localhost:3231'
    const instancia = {
      id: 'wa-existente',
      name: 'Solar',
      token: 'token-qa',
      adminField01: '',
      status: 'disconnected',
      qrcode: '',
    }
    let urlAviso = ''
    let perderConnect = true,
      perderDisconnect = true
    const chamadas: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const caminho = new URL(String(input)).pathname
      chamadas.push(caminho)
      if (caminho === '/instance/create') {
        instancia.adminField01 = JSON.parse(String(init?.body)).adminField01
        throw new Error('Resposta perdida após criar')
      }
      if (caminho === '/instance/all') return Response.json([instancia])
      if (caminho === '/webhook') {
        const configuracao = JSON.parse(String(init?.body))
        if ('retries' in configuracao)
          return new Response(null, { status: 400 })
        urlAviso = configuracao.url
        return Response.json([])
      }
      if (caminho === '/instance/connect') {
        expect(urlAviso).toContain('/api/whatsapp/aviso/')
        instancia.status = 'connecting'
        instancia.qrcode = 'data:image/png;base64,YQ=='
        if (perderConnect) {
          perderConnect = false
          throw new Error('Resposta perdida após conectar')
        }
      }
      if (caminho === '/instance/disconnect') {
        instancia.status = 'disconnected'
        instancia.qrcode = ''
        if (perderDisconnect) {
          perderDisconnect = false
          throw new Error('Resposta perdida após desconectar')
        }
      }
      if (caminho === '/webhook/errors') return Response.json([])
      if (caminho === '/chat/find')
        return Response.json({ chats: [], pagination: { hasMore: false } })
      if (caminho === '/message/find')
        return Response.json({ messages: [], pagination: { hasMore: false } })
      return Response.json({ instance: instancia })
    })
    await expect(criarNumero(env, gestora, orig, pedido)).rejects.toThrow()
    const id = await criarNumero(env, gestora, orig, pedido)
    expect(id).toBe(pedido.id)
    await expect(
      conectarNumero(env, gestora, { id, dias: 0 }, orig),
    ).rejects.toThrow('Escolha de 1 a 365 dias')
    expect(chamadas).not.toContain('/instance/connect')
    const parear = () => conectarNumero(env, gestora, { id, dias: 180 }, orig)
    await expect(parear()).rejects.toThrow()
    expect((await parear()).qr).toBe('data:image/png;base64,YQ==')
    expect(chamadas.filter((c) => c === '/instance/create')).toHaveLength(1)
    expect(chamadas.filter((c) => c === '/instance/connect')).toHaveLength(1)
    const primeiroAviso = urlAviso
    instancia.status = 'connected'
    await consultarPareamento(env, gestora, id)
    expect((await painelDoGestor(env, gestora)).numeros[0].estado).toBe(
      'conectado',
    )
    await expect(desconectarNumero(env, gestora, id)).rejects.toThrow()
    await desconectarNumero(env, gestora, id)
    expect(chamadas.filter((c) => c === '/instance/disconnect')).toHaveLength(1)
    expect((await painelDoGestor(env, gestora)).numeros[0].estado).toBe(
      'desconectado',
    )
    await parear()
    expect(urlAviso).not.toBe(primeiroAviso)
    const registro = await h.db
      .prepare(
        'SELECT token_cifrado as tokenCifrado, segredo_webhook_hash as segredoWebhookHash FROM numeros WHERE id=?',
      )
      .bind(id)
      .first<{ tokenCifrado: string; segredoWebhookHash: string }>()
    const { autenticarAviso } = await import('./uazapi')
    if (!registro) throw new Error('Número não cadastrado')
    expect(
      await autenticarAviso(
        env.UAZAPI_CHAVE,
        registro,
        primeiroAviso.split('/').pop() ?? '',
        instancia.token,
      ),
    ).toBe(false)
    expect(
      await autenticarAviso(
        env.UAZAPI_CHAVE,
        registro,
        urlAviso.split('/').pop() ?? '',
        instancia.token,
      ),
    ).toBe(true)
  } finally {
    vi.restoreAllMocks()
    await h.dispose()
  }
})

test('religa o número no servidor salvo usando só a credencial da instância escolhida', async () => {
  const { getDb } = await import('#/db')
  const { numeros } = await import('#/db/schema')
  const { medirFila } = await import('#/test/d1-fila')
  const { salvarServidor } = await import('./wa-servidor')
  const { conectarNumero } = await import('./wa-numeros-gestao')
  const { painelDoGestor } = await import('./wa-numeros')
  const h = await createAuthHarness({
    UAZAPI_URL: 'http://localhost:3233',
    UAZAPI_ADMIN_TOKEN: 'admin-anterior',
    UAZAPI_CHAVE: btoa('k'.repeat(32)),
  })
  try {
    const gestora = (await h.signIn('gestora@exemplo.test')).body.user.id
    const db = getDb(h.db)
    const { cifrarToken } = await import('./uazapi')
    await db.insert(numeros).values({
      id: 'loja',
      nome: 'Loja',
      setorId: 'com',
      funilPadraoId: 'vendas',
      cor: '#123',
      estado: 'conectado',
      estadoEm: new Date(),
      instanciaId: 'anterior',
      tokenCifrado: await cifrarToken(h.env.UAZAPI_CHAVE, 'token-anterior'),
      segredoWebhookHash: 'anterior',
    })
    const origem = 'https://empresa.example'
    const novo = {
      id: 'nova',
      name: 'Instância nova',
      status: 'connected',
      token: 'token-novo',
    }
    const pedidos: {
      origem: string
      caminho: string
      credencial: string | null
    }[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (entrada, init) => {
      const url = new URL(String(entrada))
      const headers = new Headers(init?.headers)
      pedidos.push({
        origem: url.origin,
        caminho: url.pathname,
        credencial: headers.get('token') ?? headers.get('admintoken'),
      })
      if (url.pathname === '/instance/all') return Response.json([novo])
      if (url.pathname === '/instance/status')
        return Response.json({ instance: novo })
      if (url.pathname === '/chat/find')
        return Response.json({ chats: [], pagination: { hasMore: false } })
      if (url.pathname === '/message/find')
        return Response.json({ messages: [], pagination: { hasMore: false } })
      return Response.json({})
    })
    await salvarServidor(h.env, gestora, {
      endereco: origem,
      token: 'admin-novo',
      confirmar: true,
    })
    // As leituras administrativas usam o primário inclusive quando há réplica.
    const { currentD1Session } = await import('#/db/d1-session')
    const ambienteMedido = () => ({
      ...h.env,
      DB: currentD1Session() as unknown as D1Database,
    })
    const painel = await medirFila(h.db, () =>
      painelDoGestor(ambienteMedido(), gestora),
    )
    expect(painel.resultado.numeros).toMatchObject([
      { id: 'loja', estado: 'desconectado', precisaVincular: true },
    ])
    expect([painel.filaMax, painel.total]).toEqual([2, 2])
    const catalogo = await medirFila(h.db, () =>
      catalogoDoGestor(ambienteMedido(), gestora),
    )
    expect(catalogo.resultado).toMatchObject([
      { id: 'nova', adicionada: false },
    ])
    expect([catalogo.filaMax, catalogo.total]).toEqual([2, 3])
    await conectarNumero(
      h.env,
      gestora,
      { id: 'loja', dias: 90, instanciaId: 'nova' },
      'https://crm.example',
    )
    expect(await db.select().from(numeros)).toMatchObject([
      {
        id: 'loja',
        instanciaId: 'nova',
        estado: 'conectado',
        servidorOrigem: origem,
      },
    ])
    expect(pedidos.map((p) => p.caminho)).toContain('/webhook')
    expect(
      pedidos.every(
        (p) =>
          p.origem === origem &&
          p.credencial ===
            (p.caminho === '/instance/all' ? 'admin-novo' : 'token-novo'),
      ),
    ).toBe(true)
  } finally {
    vi.restoreAllMocks()
    await h.dispose()
  }
})

test('a troca confirmada durante um aviso impede o host antigo de reativar o número ou repor o histórico', async () => {
  const { getDb } = await import('#/db')
  const { numeros, contatos } = await import('#/db/schema')
  const { cifrarToken, segredoDoEndereco, hashSegredo } = await import(
    './uazapi'
  )
  const { receberWebhook } = await import('./wa-avisos-receptor')
  const { salvarServidor } = await import('./wa-servidor')
  const h = await createAuthHarness({
    UAZAPI_URL: 'http://localhost:3233',
    UAZAPI_ADMIN_TOKEN: 'admin-antigo',
    UAZAPI_CHAVE: btoa('c'.repeat(32)),
  })
  try {
    const gestora = (await h.signIn('gestora@exemplo.test')).body.user.id
    const db = getDb(h.db)
    const segredo = await segredoDoEndereco(h.env.UAZAPI_CHAVE, 'loja')
    await db.insert(numeros).values({
      id: 'loja',
      nome: 'Loja',
      setorId: 'com',
      funilPadraoId: 'vendas',
      cor: '#123',
      estadoEm: new Date(),
      instanciaId: 'antiga',
      tokenCifrado: await cifrarToken(h.env.UAZAPI_CHAVE, 'token-antigo'),
      segredoWebhookHash: await hashSegredo(segredo),
    })
    let iniciar!: () => void, liberar!: () => void
    const iniciado = new Promise<void>((r) => {
      iniciar = r
    })
    const aguardar = new Promise<void>((r) => {
      liberar = r
    })
    const novo = 'https://nova.example'
    const chamadas: { origem: string; credencial: string | null }[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (entrada, opcoes) => {
        const url = new URL(String(entrada))
        const headers = new Headers(opcoes?.headers)
        chamadas.push({
          origem: url.origin,
          credencial: headers.get('token') ?? headers.get('admintoken'),
        })
        if (url.pathname === '/instance/status') {
          iniciar()
          await aguardar
          return Response.json({ instance: { status: 'connected' } })
        }
        if (url.pathname === '/chat/find')
          return Response.json({ chats: [], pagination: { hasMore: false } })
        if (url.pathname === '/message/find')
          return Response.json({
            messages: [
              {
                messageid: 'atrasada',
                messageTimestamp: 1700000000000,
                chatid: '5511977891234@s.whatsapp.net',
                text: 'Aviso antigo',
              },
            ],
            pagination: { hasMore: false },
          })
        return Response.json([])
      },
    )
    const tarefas: Promise<unknown>[] = []
    const avisar = () =>
      receberWebhook(
        h.env,
        new Request(`https://crm.example/api/whatsapp/aviso/loja/${segredo}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            EventType: 'connection',
            instance: { status: 'connected' },
            token: 'token-antigo',
          }),
        }),
        (p) => tarefas.push(p),
      )
    expect((await avisar()).status).toBe(200)
    await iniciado
    try {
      await salvarServidor(h.env, gestora, {
        endereco: novo,
        token: 'admin-novo',
        confirmar: true,
      })
    } finally {
      liberar()
    }
    await Promise.all(tarefas)
    expect((await avisar()).status).toBe(403)
    expect(await db.select().from(numeros)).toMatchObject([
      { id: 'loja', estado: 'desconectado', tokenCifrado: null },
    ])
    expect(await db.select().from(contatos)).toHaveLength(0)
    expect(chamadas.filter((c) => c.origem === novo)).toEqual([
      { origem: novo, credencial: 'admin-novo' },
    ])
  } finally {
    vi.restoreAllMocks()
    await h.dispose()
  }
})
