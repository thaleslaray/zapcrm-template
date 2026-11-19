import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { getDb } from '#/db'
import { contatos, conversas, numeros, pessoasSetores } from '#/db/schema'
import { createAuthHarness } from '#/test/auth-harness'
import { executarComando } from './carteira-escrita'
import { cifrarToken } from './uazapi'
import { servirFotoContato } from './wa-foto-contato'

const origemFoto = 'https://pps.whatsapp.net'
const instancia = 'http://127.0.0.1:3233'
const token = 'credencial-local-de-foto'
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])
let h: Awaited<ReturnType<typeof createAuthHarness>>
let gestora: Awaited<ReturnType<typeof h.signIn>>
let vendedor: Awaited<ReturnType<typeof h.signIn>>

beforeAll(async () => {
  h = await createAuthHarness({
    UAZAPI_URL: instancia,
    UAZAPI_ADMIN_TOKEN: 'local',
    UAZAPI_CHAVE: btoa('x'.repeat(32)),
  })
  gestora = await h.signIn('qa-foto@exemplo.test')
  vendedor = await h.signIn('qa-foto-pos@exemplo.test')
  const db = getDb(h.db)
  await db
    .insert(pessoasSetores)
    .values({ usuarioId: vendedor.body.user.id, setorId: 'pos' })
  await db.insert(numeros).values({
    id: 'linha',
    nome: 'Loja',
    setorId: 'com',
    funilPadraoId: 'vendas',
    cor: '#0f766e',
    estadoEm: new Date(),
    estado: 'conectado',
    tokenCifrado: await cifrarToken(h.env.UAZAPI_CHAVE, token),
  })
})
afterAll(async () => {
  await h?.dispose()
})

async function criarContato(fotoUrl: string | null) {
  const id = crypto.randomUUID()
  const db = getDb(h.db)
  await db.insert(contatos).values({ id, nome: 'Teste', fotoUrl })
  await db.insert(conversas).values({
    id,
    contatoId: id,
    numeroId: 'linha',
    jid: `${id}@lid`,
  })
  return id
}
function abrir(id: string, cookie = gestora.cookie, etag = '') {
  return servirFotoContato(
    h.env,
    new Request(`http://localhost:3331/api/contatos/${id}/foto`, {
      headers: { cookie, 'if-none-match': etag },
    }),
    id,
  )
}

it('só o setor acessa a foto, inclusive ao revalidar o ETag; o R2 conserva a imagem e a apaga com o contato', async () => {
  const id = await criarContato(`${origemFoto}/miniatura`)
  const rede = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (url, init) => {
      expect(String(url)).toBe(`${origemFoto}/miniatura`)
      expect(init?.redirect).toBe('manual')
      expect(new Headers(init?.headers).get('token')).toBeNull()
      return new Response(jpeg, { headers: { 'content-type': 'text/plain' } })
    })
  try {
    expect((await abrir(id, '')).status).toBe(401)
    expect((await abrir(id, vendedor.cookie)).status).toBe(404)
    expect(rede).not.toHaveBeenCalled()
    const primeira = await abrir(id)
    expect(primeira.status).toBe(200)
    expect(primeira.headers.get('content-type')).toBe('image/jpeg')
    expect(primeira.headers.get('cache-control')).toContain('private')
    expect(primeira.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await primeira.arrayBuffer())).toEqual(jpeg)
    const etag = primeira.headers.get('etag')
    if (!etag) throw new Error('A foto precisa de ETag.')
    expect((await abrir(id, gestora.cookie, etag)).status).toBe(304)
    expect((await abrir(id, vendedor.cookie, etag)).status).toBe(404)
    expect(new Uint8Array(await (await abrir(id)).arrayBuffer())).toEqual(jpeg)
    expect(rede).toHaveBeenCalledTimes(1)
    const db = getDb(h.db)
    const contato = await db
      .select()
      .from(contatos)
      .where(eq(contatos.id, id))
      .get()
    if (!contato?.fotoChave) throw new Error('Faltou o vínculo com a foto.')
    expect(await h.env.BUCKET.head(contato.fotoChave)).toBeTruthy()
    expect(
      await executarComando(db, h.env.BUCKET, gestora.body.user.id, {
        tipo: 'apagarContato',
        contatoId: id,
        conversas: 1,
        negocios: 0,
      }),
    ).toMatchObject({ ok: true })
    expect(await h.env.BUCKET.head(contato.fotoChave)).toBeNull()
  } finally {
    rede.mockRestore()
  }
})

it.each([
  ['ausente', null],
  ['prazo oe vencido', `${origemFoto}/antiga?oe=00000001`],
  ['CDN devolveu 403', `${origemFoto}/expirou`],
])('renova a URL pelo avatar da instância quando %s', async (_, inicial) => {
  const id = await criarContato(inicial)
  const rede = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (String(url) === `${instancia}/chat/avatar`)
      return Response.json({ url: `${origemFoto}/nova` })
    return String(url) === `${origemFoto}/nova`
      ? new Response(jpeg)
      : new Response(null, { status: 403 })
  })
  try {
    const foto = await abrir(id)
    expect(foto.status).toBe(200)
    expect(new Uint8Array(await foto.arrayBuffer())).toEqual(jpeg)
    const chamadas = rede.mock.calls
    const renovacoes = chamadas.filter(
      ([url]) => String(url) === `${instancia}/chat/avatar`,
    )
    expect(renovacoes).toHaveLength(1)
    const init = renovacoes[0][1]
    if (!init) throw new Error('Faltaram os dados do pedido de avatar.')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('token')).toBe(token)
    expect(JSON.parse(String(init.body))).toEqual({
      number: `${id}@lid`,
      preview: true,
    })
    if (inicial?.includes('oe='))
      expect(chamadas.map(([url]) => String(url))).not.toContain(inicial)
    expect(
      chamadas
        .filter(([url]) => String(url).startsWith(origemFoto))
        .every(([, opcoes]) => !new Headers(opcoes?.headers).has('token')),
    ).toBe(true)
  } finally {
    rede.mockRestore()
  }
})

it('o contato sem foto recebe no máximo uma consulta por 24 horas inclusive em pedidos simultâneos', async () => {
  const id = await criarContato(null)
  const rede = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => Response.json({ url: '' }))
  try {
    const respostas = await Promise.all([abrir(id), abrir(id)])
    expect(respostas.map((r) => r.status)).toEqual([404, 404])
    expect((await abrir(id)).status).toBe(404)
    expect(rede).toHaveBeenCalledTimes(1)
    await getDb(h.db)
      .update(contatos)
      .set({ fotoTentativaEm: new Date(Date.now() - 86_400_001) })
      .where(eq(contatos.id, id))
    expect((await abrir(id)).status).toBe(404)
    expect(rede).toHaveBeenCalledTimes(2)
  } finally {
    rede.mockRestore()
  }
})

it('bloqueia host fora da lista, HTTP, credenciais e portas alternativas antes do download', async () => {
  const rede = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response(jpeg))
  try {
    for (const url of [
      'https://pps.whatsapp.net.exemplo.test/foto',
      'http://pps.whatsapp.net/foto',
      'https://usuario:senha@pps.whatsapp.net/foto',
      'https://pps.whatsapp.net:8080/foto',
      'http://127.0.0.1:3233/foto',
    ]) {
      expect((await abrir(await criarContato(url))).status).toBe(404)
    }
    expect(rede).not.toHaveBeenCalled()
  } finally {
    rede.mockRestore()
  }
})

it('recusa redirecionamento, conteúdo disfarçado e imagem acima de 256 KiB, mesmo sem Content-Length', async () => {
  const excessiva = new Uint8Array(256 * 1024 + 1)
  excessiva.set(jpeg)
  const rede = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Pedido de rede inesperado.'))
  try {
    for (const resposta of [
      Response.redirect('https://externo.exemplo.test/foto'),
      new Response('<html>segredo</html>', {
        headers: { 'content-type': 'image/jpeg' },
      }),
      new Response(jpeg, {
        headers: { 'content-length': String(excessiva.length) },
      }),
      new Response(excessiva),
    ]) {
      rede.mockResolvedValueOnce(resposta)
      const r = await abrir(await criarContato(`${origemFoto}/imagem`))
      expect(r.status).toBe(404)
      expect(await r.text()).toBe('')
    }
    expect(rede).toHaveBeenCalledTimes(4)
    expect(
      rede.mock.calls.every(
        ([url, init]) =>
          String(url) === `${origemFoto}/imagem` && init?.redirect === 'manual',
      ),
    ).toBe(true)
  } finally {
    rede.mockRestore()
  }
})
