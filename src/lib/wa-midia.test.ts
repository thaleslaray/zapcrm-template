import { expect, it, vi } from 'vitest'
import { getDb } from '#/db'
import {
  avisosPendentes,
  mensagens,
  numeros,
  pessoasSetores,
} from '#/db/schema'
import { createAuthHarness } from '#/test/auth-harness'
import { cifrarToken, hashSegredo } from './uazapi'
import { processarAviso } from './wa-avisos'
import { receberWebhook, retomarAvisos } from './wa-avisos-receptor'
import { servirMidia } from './wa-midia'
import { painelDoGestor } from './wa-numeros'

it('o aviso exige os dois segredos; o documento salvo continua legível só no setor depois que o provedor sai do ar', async () => {
  const h = await createAuthHarness({
    UAZAPI_URL: 'http://localhost:3233',
    UAZAPI_ADMIN_TOKEN: 'admin-local',
    UAZAPI_CHAVE: btoa('x'.repeat(32)),
  })
  try {
    const gestora = await h.signIn('qa-gestora@exemplo.test')
    const vendedor = await h.signIn('qa-pos@exemplo.test')
    const db = getDb(h.db)
    await db
      .insert(pessoasSetores)
      .values({ usuarioId: vendedor.body.user.id, setorId: 'pos' })
    const segredo = 's'.repeat(43) // Formato base64url dos endereços legados.
    const token = 'credencial-de-instancia'
    const vinculo = await cifrarToken(h.env.UAZAPI_CHAVE, token)
    await db.insert(numeros).values({
      id: 'linha',
      nome: 'Loja',
      historicoPedido: 'pareamento',
      setorId: 'com',
      estadoEm: new Date(),
      funilPadraoId: 'vendas',
      cor: '#0f766e',
      tokenCifrado: vinculo,
      segredoWebhookHash: await hashSegredo(segredo),
    })
    const tarefas: Promise<unknown>[] = []
    const webhook = (endereco: string, credencial: string) =>
      receberWebhook(
        h.env,
        new Request(
          `http://localhost:3231/api/whatsapp/aviso/linha/${endereco}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              EventType: 'history',
              event: 'messages',
              request_id: 'pareamento',
              batchChunkOrder: 1,
              token: credencial,
              messages: [
                {
                  messageid: 'ARQ',
                  id: 'owner:ARQ',
                  chatid: '5511977891234@s.whatsapp.net',
                  messageType: 'DocumentMessage',
                  content: { fileName: 'Proposta.pdf' },
                  messageTimestamp: 1700000000000,
                },
              ],
            }),
          },
        ),
        (p) => tarefas.push(p),
      )
    expect((await webhook('incorreto', token)).status).toBe(403)
    expect((await webhook(segredo, 'incorreta')).status).toBe(403)
    let iniciou!: () => void
    const iniciouDownload = new Promise<void>((resolve) => {
      iniciou = resolve
    })
    let liberar!: () => void
    const bloqueio = new Promise<void>((resolve) => {
      liberar = resolve
    })
    let indisponivel = true
    const rede = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url) => {
        if (String(url).endsWith('/message/download')) {
          iniciou()
          await bloqueio
          if (indisponivel) return new Response(null, { status: 503 })
          return Response.json({
            fileURL: 'http://localhost:3233/cdn/arquivo',
            mimetype: 'application/pdf',
          })
        }
        return new Response('%PDF-documento local', {
          headers: { 'content-type': 'application/pdf' },
        })
      })
    const ok = await webhook(segredo, token)
    expect(ok.status).toBe(200)
    expect(await ok.text()).not.toContain(token)
    await iniciouDownload
    await processarAviso(
      h.env,
      'linha',
      { endereco: 'http://localhost:3233', token, vinculo },
      {
        EventType: 'history',
        event: 'status',
        request_id: 'pareamento',
        batchHistoryStatus: 'complete',
        batchChunkOrder: 1,
      },
    )
    const painel = () => painelDoGestor(h.env, gestora.body.user.id)
    expect((await painel()).numeros).toMatchObject([{ sincronizando: true }])
    liberar()
    await Promise.all(tarefas)
    const pendentes = await db.select().from(avisosPendentes)
    expect(pendentes).toHaveLength(1)
    expect(pendentes[0].conteudo).not.toContain(token)
    expect(pendentes[0].conteudo).not.toContain(segredo)
    expect(pendentes[0].conteudo).not.toContain(h.env.UAZAPI_URL)
    indisponivel = false
    await retomarAvisos(h.env)
    expect(await db.select().from(avisosPendentes)).toEqual([])
    expect((await painel()).numeros).toMatchObject([{ sincronizando: false }])
    rede.mockRestore()
    const [m] = await db.select().from(mensagens)
    expect(m.arquivoChave).toBeTruthy()
    const arquivo = (cookie: string) =>
      servirMidia(
        h.env,
        new Request(`http://localhost:3231/api/whatsapp/midia/${m.id}`, {
          headers: { cookie },
        }),
        m.id,
      )
    expect((await arquivo('')).status).toBe(401)
    expect((await arquivo(vendedor.cookie)).status).toBe(404)
    const res = await arquivo(gestora.cookie)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('%PDF-documento local')
    expect(res.headers.get('cache-control')).toContain('no-store')
  } finally {
    vi.restoreAllMocks()
    await h.dispose()
  }
})
