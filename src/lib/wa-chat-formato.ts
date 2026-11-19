import { nomeSemTelefone, normalizarTelefone } from './telefone'
import { objeto } from './uazapi'

const jidTelefone = /^(\d{7,15})@s\.whatsapp\.net$/
export const jidLid = /^[a-zA-Z0-9._:-]{1,128}@lid$/

function identidadeRemetente(valor: unknown) {
  if (typeof valor !== 'string') return null
  if (jidLid.test(valor)) return valor
  const numero =
    jidTelefone.exec(valor)?.[1] ??
    (/^\+?\d{7,15}$/.test(valor) ? valor.replace('+', '') : null)
  if (!numero) return null
  try {
    return normalizarTelefone(`+${numero}`)
  } catch {
    return null
  }
}

function texto(v: unknown, max = 255) {
  return typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null
}

export function nomeDoChat(
  chat: Record<string, unknown>,
  telefone: string | null,
) {
  const numero = telefone ?? texto(chat.phone)
  for (const campo of [chat.wa_contactName, chat.name, chat.wa_name]) {
    const nome = nomeSemTelefone(texto(campo), numero)
    if (nome) return nome
  }
  return null
}

export function lerChatWa(valor: unknown, dono?: unknown) {
  const chat = objeto(valor)
  const id = texto(chat.wa_chatid)
  if (!id || chat.wa_isGroup === true) return null
  const telefone = jidTelefone.exec(id)?.[1] ?? null
  if (!telefone && !jidLid.test(id)) return null
  const jid = telefone ? id : null
  const alternativo = texto(chat.wa_chatlid)
  const lid = jidLid.test(id)
    ? id
    : alternativo && jidLid.test(alternativo)
      ? alternativo
      : null
  let chave: string | null = null
  try {
    if (telefone) chave = normalizarTelefone(`+${telefone}`)
  } catch {
    return null
  }
  const donos = [dono, chat.owner].map(identidadeRemetente)
  if ((chave && donos.includes(chave)) || (lid && donos.includes(lid)))
    return null
  const nome = nomeDoChat(chat, telefone)
  // Sem telefone e sem nome não há como reconhecer nem atender a pessoa.
  if (!telefone && !nome) return null
  const timestamp = chat.wa_lastMsgTimestamp
  const instante =
    typeof timestamp === 'number' &&
    Number.isSafeInteger(timestamp) &&
    timestamp > 0 &&
    timestamp <= 8.64e15
      ? timestamp < 1e11
        ? timestamp * 1000
        : timestamp
      : null
  const naoLidas =
    typeof chat.wa_unreadCount === 'number' &&
    Number.isSafeInteger(chat.wa_unreadCount) &&
    chat.wa_unreadCount >= 0
      ? chat.wa_unreadCount
      : null
  const sender = identidadeRemetente(chat.wa_lastMessageSender)
  const pessoa = sender && (sender === chave || sender === lid)
  const proprio = sender && donos.includes(sender)
  const previaDirecao = pessoa ? 'recebida' : proprio ? 'enviada' : null
  const previaTexto = texto(chat.wa_lastMessageTextVote, 65536)
  const tipo =
    texto(chat.wa_lastMessageType) ?? (previaTexto ? 'Conversation' : null)
  const reacao = tipo && /^reaction(message)?$/i.test(tipo)
  return {
    identidade: id,
    fotoUrl: texto(chat.imagePreview, 8192) ?? texto(chat.image, 8192),
    previaTexto: reacao ? null : previaTexto,
    previaTipo: reacao ? 'ReactionMessage' : tipo,
    previaDirecao,
    remetenteTelefone:
      sender && !jidLid.test(sender) ? telefonesDaConta(sender) : [],
    chave,
    telefone,
    jid,
    lid,
    instante,
    naoLidas,
    nome,
  }
}

export type ChatWa = NonNullable<ReturnType<typeof lerChatWa>>

// Formas usadas no cadastro do número, com e sem o nono dígito do Brasil.
export function telefonesDaConta(chave: string | null) {
  if (!chave) return []
  const comNono = chave.replace(
    /^(55\d{2})(\d{8})$/,
    (_v, inicio, fim) => `${inicio}9${fim}`,
  )
  return comNono === chave ? [chave] : [chave, comNono]
}
