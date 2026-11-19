import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { type APIRequestContext, expect, type Page } from '@playwright/test'

export async function segredosLocais() {
  const env = parseEnv(await readFile('.dev.vars', 'utf8'))
  if (env.UAZAPI_URL !== 'http://127.0.0.1:3233' || !env.UAZAPI_ADMIN_TOKEN)
    throw new Error('O teste requer a uazapi falsa na porta 3233.')
  return {
    UAZAPI_URL: env.UAZAPI_URL,
    UAZAPI_ADMIN_TOKEN: env.UAZAPI_ADMIN_TOKEN,
    UAZAPI_CHAVE: env.UAZAPI_CHAVE ?? '',
  }
}
export async function controle(
  request: APIRequestContext,
  acao: string,
  nome: string,
  extras: Record<string, unknown> = {},
) {
  const env = await segredosLocais()
  const resposta = await request.post(`${env.UAZAPI_URL}/teste/${acao}`, {
    headers: { admintoken: env.UAZAPI_ADMIN_TOKEN },
    data: { nome, ...extras },
  })
  expect(resposta.ok()).toBe(true)
  return resposta.json()
}
export async function emitir(
  request: APIRequestContext,
  nome: string,
  evento: Record<string, unknown>,
) {
  expect((await controle(request, 'avisar', nome, { evento })).status).toBe(200)
}
export function mensagem(
  id: string,
  nome: string,
  telefone: string,
  texto: string,
  extras: Record<string, unknown> = {},
) {
  return {
    id: `551140028922:${id}`,
    messageid: id,
    senderName: nome,
    chatid: `${telefone}@s.whatsapp.net`,
    fromMe: false,
    isGroup: false,
    messageType: 'Conversation',
    text: texto,
    messageTimestamp: Date.now(),
    ...extras,
  }
}
export async function capturar(page: Page, nome: string) {
  const pasta = process.env.ZAPCRM_CAPTURAS_03
  if (!pasta) return
  await mkdir(pasta, { recursive: true })
  await page.screenshot({
    path: path.join(pasta, `${nome}.png`),
    animations: 'disabled',
  })
}
