import { env } from 'cloudflare:workers'
import { expect, it, vi } from 'vitest'
import { getDb } from '#/db'
import {
  contatos,
  conversas,
  etapas,
  funis,
  mensagens,
  negocios,
  numeros,
  pessoasSetores,
} from '#/db/schema'
import { lerChat, listarConversas, marcarLida } from '#/lib/wa-conversas'
import { createAuthHarness } from '#/test/auth-harness'
import { medirFila } from '#/test/d1-fila'

it('a fila e o chat respeitam o setor, a leitura zera as não lidas e o token fica no servidor', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const gestora = (await h.signIn('qa-gestora@exemplo.test')).body.user.id
    const colega = (await h.signIn('qa-colega@exemplo.test')).body.user.id
    await db
      .insert(pessoasSetores)
      .values({ usuarioId: colega, setorId: 'pos' })
    await db.insert(numeros).values({
      id: 'n',
      nome: 'Comercial',
      cor: '#0f766e',
      estadoEm: new Date(),
      setorId: 'com',
      funilPadraoId: 'vendas',
      tokenCifrado: 'credencial-privada',
    })
    await db.insert(numeros).values({
      id: 'incompleto',
      nome: 'Cadastro interrompido',
      cor: '#0f766e',
      setorId: 'com',
      funilPadraoId: 'vendas',
    })
    await db.insert(contatos).values({ id: 'c', nome: 'Ana' })
    await db
      .insert(conversas)
      .values({ id: 'chat', contatoId: 'c', numeroId: 'n', naoLidas: 2 })
    await db.insert(mensagens).values({
      id: 'm1',
      numeroId: 'n',
      conversaId: 'chat',
      direcao: 'recebida',
      estado: 'entregue',
      tipo: 'texto',
      texto: 'Olá!',
      instante: new Date(),
    })
    // O segundo funil do Comercial tem o negócio mais recente, de outra pessoa.
    await db
      .insert(funis)
      .values({ id: 'extra', nome: 'Projetos', cor: 'azul', setorId: 'com' })
    await db.insert(etapas).values({
      id: 'avaliar',
      nome: 'Avaliar',
      cor: 'azul',
      funilId: 'extra',
      posicao: 1,
    })
    await db.insert(negocios).values([
      {
        id: 'original',
        contatoId: 'c',
        funilId: 'vendas',
        etapaId: 'novo',
        responsavelId: gestora,
        criadoEm: new Date(1000),
      },
      {
        id: 'recente',
        contatoId: 'c',
        funilId: 'extra',
        etapaId: 'avaliar',
        responsavelId: colega,
        criadoEm: new Date(2000),
      },
    ])
    const { resultado, filaMax } = await medirFila(h.db, () =>
      listarConversas(getDb(h.db), gestora),
    )
    expect(resultado.lista).toMatchObject([
      { id: 'chat', nome: 'Ana', ultimaTexto: 'Olá!', naoLidas: 2 },
    ])
    expect(resultado.lista[0]).toMatchObject({
      funil: 'Vendas',
      etapa: 'Novo',
      responsavelId: gestora,
    })
    expect(resultado.numeros.map((n) => n.id)).toEqual(['n'])
    expect(filaMax).toBeLessThanOrEqual(2)
    expect(JSON.stringify(resultado)).not.toContain('credencial-privada')
    expect((await listarConversas(db, colega)).lista).toEqual([])
    await expect(lerChat(db, colega, 'chat')).rejects.toThrow('Sem acesso')
    await expect(marcarLida(db, colega, 'chat')).rejects.toThrow('Sem acesso')
    expect(await lerChat(db, gestora, 'chat')).toMatchObject([
      { texto: 'Olá!' },
    ])
    await marcarLida(db, gestora, 'chat')
    expect((await listarConversas(db, gestora)).lista[0].naoLidas).toBe(0)
  } finally {
    await h.dispose()
  }
})

it('uma resposta perdida é conciliada pela correlação antes de mandar de novo', async () => {
  const { enviarTexto } = await import('./wa-conversas-envio')
  const { cifrarToken } = await import('./uazapi')
  const h = await createAuthHarness()
  const chave = btoa('k'.repeat(32))
  try {
    const db = getDb(h.db)
    const gestora = (await h.signIn('qa-gestora@exemplo.test')).body.user.id
    const colega = (await h.signIn('qa-colega@exemplo.test')).body.user.id
    await db.insert(numeros).values({
      id: 'linha',
      nome: 'Equipe',
      estado: 'conectado',
      cor: '#0f766e',
      estadoEm: new Date(),
      setorId: 'com',
      funilPadraoId: 'vendas',
      tokenCifrado: await cifrarToken(chave, 'token-local'),
    })
    await db.insert(contatos).values({ id: 'ana', nome: 'Ana' })
    await db.insert(conversas).values({
      id: 'conversa',
      contatoId: 'ana',
      numeroId: 'linha',
      jid: '5511999991234@s.whatsapp.net',
    })
    const pedido = {
      conversaId: 'conversa',
      id: crypto.randomUUID(),
      texto: 'Vou confirmar.',
      repetir: false,
    }
    const vars = {
      UAZAPI_URL: 'http://127.0.0.1:3233',
      UAZAPI_ADMIN_TOKEN: 'admin-local',
      UAZAPI_CHAVE: chave,
    }
    let enviados = 0
    const f = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url, init) => {
        const body = JSON.parse(String(init?.body))
        if (String(url).endsWith('/send/text')) {
          expect(body.track_id).toBe(pedido.id)
          enviados++
          throw new Error('Conexão interrompida depois de aceitar o texto')
        }
        return Response.json({
          messages: [
            {
              track_id: pedido.id,
              track_source: 'zapcrm',
              messageid: 'wa1',
              status: 'Delivered',
            },
          ],
        })
      })
    try {
      await expect(enviarTexto(db, vars, colega, pedido)).rejects.toThrow(
        'Sem acesso',
      )
      await Promise.all([
        enviarTexto(db, vars, gestora, pedido),
        enviarTexto(db, vars, gestora, pedido),
      ])
      await enviarTexto(db, vars, gestora, { ...pedido, repetir: true })
      expect(enviados).toBe(1)
      expect(await lerChat(db, gestora, pedido.conversaId)).toMatchObject([
        { id: pedido.id, texto: 'Vou confirmar.', estado: 'entregue' },
      ])

      f.mockImplementation(async (_url, init) => {
        const { track_id } = JSON.parse(String(init?.body))
        return Response.json({ messageid: `wa-${track_id}`, status: 'Sent' })
      })
      const segunda = {
        ...pedido,
        id: crypto.randomUUID(),
        texto: 'Quinta às 10h.',
      }
      const terceira = {
        ...pedido,
        id: crypto.randomUUID(),
        texto: 'Posso reservar?',
      }
      // O provedor confirma os dois textos sem devolver ecos ao ZapCRM.
      // Mesmo com o transporte de avisos travado, a gravação chega à equipe.
      const setoresAvisados: string[] = []
      let interromper!: () => void
      const interrupcao = new Promise<void>((_, reject) => {
        interromper = () =>
          reject(new Error('Transporte de aviso indisponível'))
      })
      const binding = env.TEMPO_REAL
      Object.assign(env, {
        TEMPO_REAL: {
          getByName: (setor: string) => ({
            avisar: () => {
              setoresAvisados.push(setor)
              return interrupcao
            },
          }),
        },
      })
      try {
        const estados = await Promise.all([
          enviarTexto(db, vars, gestora, segunda),
          enviarTexto(db, vars, gestora, terceira),
        ])
        expect(estados).toEqual(['enviada', 'enviada'])
        expect(setoresAvisados).toEqual(['com', 'com'])
        interromper()
      } finally {
        Object.assign(env, { TEMPO_REAL: binding })
      }
      const rapidas = (await lerChat(db, gestora, pedido.conversaId)).filter(
        (m) => m.id !== pedido.id,
      )
      expect(rapidas.map((m) => m.texto).sort()).toEqual([
        'Posso reservar?',
        'Quinta às 10h.',
      ])
      expect(
        rapidas[1].instante.getTime() - rapidas[0].instante.getTime(),
      ).toBeLessThan(1000)
      for (const status of ['Failed', 'Expired', 'Canceled', 'Deleted']) {
        const falhou = { ...pedido, id: crypto.randomUUID() }
        f.mockImplementation(async (url: unknown, init) => {
          if (String(url).endsWith('/send/text'))
            throw new Error('Resposta perdida')
          const { track_id, track_source } = JSON.parse(String(init?.body))
          return Response.json({
            messages: [{ track_id, track_source, messageid: status, status }],
          })
        })
        expect(await enviarTexto(db, vars, gestora, falhou)).toBe('falha')
        expect(
          await enviarTexto(db, vars, gestora, { ...falhou, repetir: true }),
        ).toBe('falha')
      }
    } finally {
      f.mockRestore()
    }
  } finally {
    await h.dispose()
  }
})
