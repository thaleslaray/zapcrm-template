import { env } from 'cloudflare:workers'
import { expect, it, vi } from 'vitest'
import { getDb } from '#/db'
import { runWithD1Session } from '#/db/d1-session'
import { numeros } from '#/db/schema'
import { createAuthHarness } from '#/test/auth-harness'
import { d1ComAtraso } from '#/test/d1-fila'
import { hashSegredo, segredoDoEndereco } from './uazapi'
import { receberWebhook } from './wa-avisos-receptor'

it('limita o ingresso legado antes da consulta e só lê o corpo após validar o endereço cadastrado', async () => {
  const h = await createAuthHarness({ UAZAPI_CHAVE: btoa('x'.repeat(32)) })
  const original = env.PUBLIC_RATE_LIMIT
  const limit = vi.fn().mockResolvedValue({ success: false })
  try {
    await h.signIn('gestora@exemplo.test')
    await getDb(h.db)
      .insert(numeros)
      .values({
        id: 'linha',
        nome: 'Loja',
        setorId: 'com',
        funilPadraoId: 'vendas',
        cor: '#123',
        segredoWebhookHash: await hashSegredo('s'.repeat(43)),
      })
    Object.assign(env, { PUBLIC_RATE_LIMIT: { limit } })
    const medidor = d1ComAtraso(h.db, 1)
    const receber = async (segredo = 'antigo') => {
      const r = new Request(
        `https://exemplo.test/api/whatsapp/aviso/linha/${segredo}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      )
      const res = await runWithD1Session(medidor.sessao, () =>
        receberWebhook(h.env, r, () => {}),
      )
      return [res.status, r.bodyUsed]
    }
    expect(await receber()).toEqual([429, false])
    expect(medidor.total()).toBe(0)
    expect(limit).toHaveBeenCalledOnce()
    limit.mockResolvedValue({ success: true })
    expect(await receber()).toEqual([403, false])
    expect(medidor.total()).toBe(0)
    expect(await receber('a'.repeat(43))).toEqual([403, false])
    expect(medidor.total()).toBe(1)
    const deOutraLinha = await segredoDoEndereco(
      h.env.UAZAPI_CHAVE,
      'outra',
      '7',
    )
    expect(await receber(deOutraLinha)).toEqual([403, false])
    expect(medidor.total()).toBe(1)
  } finally {
    Object.assign(env, { PUBLIC_RATE_LIMIT: original })
    await h.dispose()
  }
})
