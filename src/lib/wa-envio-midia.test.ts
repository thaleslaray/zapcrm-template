import { expect, it, vi } from 'vitest'
import { getDb } from '#/db'
import { contatos, conversas, numeros, pessoasSetores } from '#/db/schema'
import { createAuthHarness } from '#/test/auth-harness'
import { medirFila } from '#/test/d1-fila'
import { executarComando } from './carteira-escrita'
import { cifrarToken } from './uazapi'
import { lerChat } from './wa-conversas'
import { receberEnvioMidia } from './wa-envio-midia'
import { servirMidia } from './wa-midia'

it('guarda uma cópia por mensagem, concilia a resposta perdida e apaga o arquivo com o contato', async () => {
  const h = await createAuthHarness({
    UAZAPI_URL: 'http://localhost:3233',
    UAZAPI_ADMIN_TOKEN: 'admin-local',
    UAZAPI_CHAVE: btoa('x'.repeat(32)),
  })
  try {
    const gestora = await h.signIn('qa-gestora@exemplo.test')
    const vendedor = await h.signIn('qa-vendas@exemplo.test')
    const db = getDb(h.db)
    await db
      .insert(pessoasSetores)
      .values({ usuarioId: vendedor.body.user.id, setorId: 'pos' })
    await db.insert(numeros).values({
      id: 'n',
      nome: 'Loja',
      estadoEm: new Date(),
      setorId: 'com',
      funilPadraoId: 'vendas',
      cor: '#0f766e',
      tokenCifrado: await cifrarToken(h.env.UAZAPI_CHAVE, 'local'),
    })
    await db.insert(contatos).values({ id: 'ana', nome: 'Ana' })
    await db.insert(conversas).values({
      id: 'conversa',
      contatoId: 'ana',
      numeroId: 'n',
      jid: '5511988888888@s.whatsapp.net',
    })
    const id = crypto.randomUUID()
    const origem = 'http://localhost:3261'
    const pdf = '%PDF-1.4\nproposta'
    function post(cookie: string, body?: string, origin = origem) {
      return receberEnvioMidia(
        h.env,
        new Request(`${origem}/api/whatsapp/envio/conversa/${id}`, {
          method: 'POST',
          headers: {
            cookie,
            origin,
            ...(body === undefined
              ? {}
              : {
                  'x-arquivo-nome': 'Proposta.pdf',
                  'content-type': 'image/png',
                }),
          },
          body,
        }),
        'conversa',
        id,
      )
    }
    expect(
      (await post(gestora.cookie, pdf, 'https://outro.example')).status,
    ).toBe(403)
    expect((await post('', pdf)).status).toBe(401)
    expect((await post(vendedor.cookie, pdf)).status).toBe(403)
    expect((await post(gestora.cookie)).status).toBe(404)
    const acesso = vi.spyOn(await import('./session-access'), 'enforceAccess')
    const destino = vi.spyOn(
      await import('./wa-conversas-envio'),
      'destinoDaConversa',
    )
    const formatos = vi.spyOn(
      await import('./wa-arquivo-envio'),
      'validarArquivoEnvio',
    )
    let revalidouDepoisDoArquivo = false
    let envios = 0
    let consultas = 0
    const aceitos: object[] = []
    const rede = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url) => {
        if (String(url).endsWith('/message/find')) {
          consultas++
          return Response.json({ messages: aceitos })
        }
        const formato = formatos.mock.invocationCallOrder.at(-1) ?? Infinity
        revalidouDepoisDoArquivo =
          (acesso.mock.invocationCallOrder.at(-1) ?? 0) > formato &&
          (destino.mock.invocationCallOrder.at(-1) ?? 0) > formato
        envios++
        aceitos.push({
          track_id: id,
          track_source: 'zapcrm',
          messageid: 'PROPOSTA',
          status: 'Delivered',
        })
        throw new Error('Resposta perdida após aceitar')
      })
    await Promise.all([post(gestora.cookie, pdf), post(gestora.cookie, pdf)])
    expect(await post(vendedor.cookie)).toHaveProperty('status', 403)
    expect(await (await post(gestora.cookie)).json()).toMatchObject({
      estado: 'entregue',
    })
    expect(revalidouDepoisDoArquivo).toBe(true)
    expect(envios).toBe(1)
    expect(consultas).toBe(1)
    const chamada = rede.mock.calls.find(([url]) =>
      String(url).endsWith('/send/media'),
    )
    expect(JSON.parse(String(chamada?.[1]?.body))).toMatchObject({
      file: btoa(pdf),
      type: 'document',
      mimetype: 'application/pdf',
      docName: 'Proposta.pdf',
      number: '5511988888888@s.whatsapp.net',
      track_id: id,
    })
    rede.mockRestore()
    const { resultado, filaMax } = await medirFila(h.db, () =>
      lerChat(getDb(h.db), gestora.body.user.id, 'conversa'),
    )
    expect(resultado).toMatchObject([
      {
        id,
        tipo: 'documento',
        nomeArquivo: 'Proposta.pdf',
        bytes: pdf.length,
        temArquivo: 1,
      },
    ])
    expect(filaMax).toBeLessThanOrEqual(2)
    const arquivo = (cookie: string) =>
      servirMidia(h.env, new Request(origem, { headers: { cookie } }), id)
    expect(await (await arquivo(gestora.cookie)).text()).toBe(pdf)
    expect((await arquivo(vendedor.cookie)).status).toBe(404)
    expect((await h.env.BUCKET.list()).objects).toHaveLength(1)
    expect(
      await executarComando(db, h.env.BUCKET, gestora.body.user.id, {
        tipo: 'apagarContato',
        contatoId: 'ana',
        conversas: 1,
        negocios: 0,
      }),
    ).toMatchObject({ ok: true })
    expect((await h.env.BUCKET.list()).objects).toHaveLength(0)
  } finally {
    vi.restoreAllMocks()
    await h.dispose()
  }
})
