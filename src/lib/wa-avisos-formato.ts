import { lotesWa } from './wa-lotes'
// Adaptador do contrato 3.0.0. Formatos de instância, QR e código, estados de
// conexão e entrega, IDs, LID e conteúdo de mídia aguardam a prova real descrita
// em docs/uazapi.md. Os consumidores trabalham com o vocabulário do ZapCRM.

import { nomeSemTelefone, normalizarTelefone } from './telefone'
import { objeto, UazapiErro } from './uazapi'
import { type ChatWa, jidLid, lerChatWa, nomeDoChat } from './wa-chat-formato'
import {
  lerResultadoManual,
  type ResultadoManual,
} from './wa-historico-resultado'

import { lerInterativa } from './wa-interativa'

const campo = (v: unknown, max = 255) =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null

export function estadoEntrega(v: unknown) {
  switch (String(v).toLowerCase()) {
    case 'queued':
    case 'pending':
      return 'fila'
    case 'failed':
    case 'expired':
    case 'canceled':
      return 'falha'
    case 'sent':
    case 'serverack':
      return 'enviada'
    case 'delivered':
    case 'deliveryack':
      return 'entregue'
    case 'read':
    case 'played':
      return 'lida'
    default:
      return null
  }
}

// Deleted descreve o conteúdo apagado e não confirma nenhuma etapa de envio.
export function estadoDaMensagem(status: unknown) {
  if (typeof status === 'string' && status.toLowerCase() === 'deleted')
    return null
  return estadoEntrega(status) ?? 'enviada'
}

const tipos = {
  conversation: 'texto',
  text: 'texto',
  extendedtextmessage: 'texto',
  imagemessage: 'foto',
  image: 'foto',
  audiomessage: 'audio',
  audio: 'audio',
  documentmessage: 'documento',
  document: 'documento',
  documentwithcaptionmessage: 'documento',
} as const

const semConteudo = new Set([
  'reactionmessage',
  'reaction',
  'protocolmessage',
  'senderkeydistributionmessage',
  'messagecontextinfo',
  // Aviso interno do WhatsApp, sem conteúdo para a conversa.
  'unknownmessagetype',
])
const comMarcador = new Set([
  'video',
  'videomessage',
  'sticker',
  'stickermessage',
])

function marcadorDaMensagem(tipo: string, enviada: boolean) {
  switch (tipo) {
    case 'video':
    case 'videomessage':
      return enviada
        ? 'Vídeo enviado. Abra no WhatsApp para ver.'
        : 'Vídeo recebido. Abra no WhatsApp para ver.'
    case 'sticker':
    case 'stickermessage':
      return 'Figurinha'
    case 'call':
      return enviada ? 'Ligação feita' : 'Ligação recebida'
    case 'contactmessage':
    case 'contactsarraymessage':
      return 'Contato compartilhado'
    case 'locationmessage':
    case 'livelocationmessage':
      return 'Localização'
    default:
      return 'Mensagem não suportada'
  }
}

const pn = /^\d{7,15}@s\.whatsapp\.net$/
export function individual(v: unknown) {
  return typeof v === 'string' && (pn.test(v) || jidLid.test(v))
}

export function identificadorMensagem(valor: unknown) {
  const m = objeto(valor)
  return campo(m.messageid) ?? campo(m.id)
}

export function lerMensagem(valor: unknown, snapshot?: unknown) {
  const m = objeto(valor)
  const chat = objeto(snapshot)
  const destino = campo(m.chatid)
  if (
    !destino ||
    !individual(destino) ||
    m.isGroup === true ||
    chat.wa_isGroup === true
  )
    return null
  const jid =
    [destino, m.fromMe !== true && m.sender_pn, chat.wa_chatid].find(
      (v): v is string => typeof v === 'string' && pn.test(v),
    ) ?? null
  const lid =
    [
      destino,
      m.chatlid,
      m.fromMe !== true && m.sender_lid,
      chat.wa_chatlid,
    ].find((v): v is string => typeof v === 'string' && jidLid.test(v)) ?? null
  const telefone = jid?.split('@')[0] ?? null
  let chaveTelefone: string | null = null
  if (telefone) {
    try {
      chaveTelefone = normalizarTelefone(`+${telefone}`)
    } catch {
      return null
    }
  }
  const identificador = identificadorMensagem(m)
  const instante = m.messageTimestamp
  if (
    !identificador ||
    typeof instante !== 'number' ||
    !Number.isSafeInteger(instante) ||
    instante <= 0 ||
    instante > 8.64e15
  )
    return null
  const origemTipo = (
    campo(m.messageType) ??
    (m.messageType == null && m.text ? 'Conversation' : '')
  ).toLowerCase()
  // Reações e avisos de protocolo não são mensagens da conversa.
  if (semConteudo.has(origemTipo)) return null
  const tipo = Object.hasOwn(tipos, origemTipo)
    ? tipos[origemTipo as keyof typeof tipos]
    : null
  const content = objeto(m.content)
  const de = m.fromMe === true
  const legenda = campo(m.text, 65536) ?? campo(content.caption, 65536)
  const leitura = lerInterativa(origemTipo, m.content, m.vote)
  const corpo = legenda ?? leitura?.corpo
  let texto: string | null
  if (tipo) texto = legenda ?? campo(m.content, 65536)
  else if (leitura?.escolha) texto = leitura.escolha
  else if (comMarcador.has(origemTipo))
    texto = [marcadorDaMensagem(origemTipo, de), legenda]
      .filter(Boolean)
      .join('\n')
  else
    texto =
      corpo ?? (leitura?.interativa ? null : marcadorDaMensagem(origemTipo, de))
  return {
    identificador,
    idDownload: campo(m.id) ?? identificador,
    instante,
    jid,
    lid,
    telefone,
    chaveTelefone,
    nome:
      nomeDoChat(chat, telefone) ??
      (de ? null : nomeSemTelefone(campo(m.senderName), telefone)) ??
      telefone ??
      'Contato do WhatsApp',
    de,
    tipo: tipo ?? 'texto',
    texto,
    interativa: leitura?.interativa ?? null,
    respostaInterativa: Boolean(leitura?.escolha),
    // A edição chega como mensagem nova que aponta para a original.
    edita: campo(m.edited),
    estado: estadoDaMensagem(m.status),
    trackId: de && m.track_source === 'zapcrm' ? campo(m.track_id) : null,
    arquivoNome:
      campo(content.fileName) ?? campo(content.filename) ?? campo(m.fileName),
    duracao:
      typeof content.seconds === 'number' &&
      Number.isFinite(content.seconds) &&
      content.seconds >= 0
        ? Math.floor(content.seconds)
        : null,
  }
}
export type MensagemWa = NonNullable<ReturnType<typeof lerMensagem>>

export type Aviso =
  | {
      tipo: 'mensagens'
      mensagens: MensagemWa[]
      historico: boolean
      pedido?: string | null
    }
  | ResultadoManual
  | { tipo: 'recibo'; ids: string[]; nivel: number }
  | { tipo: 'carga'; pedido: string | null; ordem: number; terminou: boolean }
  | {
      tipo: 'conexao'
      estado: 'conectado' | 'conectando' | 'desconectado'
      telefone: string | null
    }
  | { tipo: 'chat'; jid: string; nome: string }
  | { tipo: 'chats'; chats: ChatWa[]; pedido?: string | null }

function nomeChat(valor: unknown): Aviso[] {
  const c = objeto(valor)
  const jid = campo(c.wa_chatid)
  if (!jid || !individual(jid)) return []
  const telefone = pn.test(jid) ? jid.split('@')[0] : null
  const nome = nomeDoChat(c, telefone)
  return nome ? [{ tipo: 'chat', jid, nome }] : []
}

export function lerAviso(valor: unknown): Aviso[] {
  const a = objeto(valor)
  switch (a.EventType) {
    case 'messages': {
      const m = lerMensagem(a.message, a.chat)
      return m ? [{ tipo: 'mensagens', mensagens: [m], historico: false }] : []
    }
    case 'messages_update': {
      const ev = objeto(a.event)
      const destino = ev.chatid ?? ev.Chat
      if (
        a.type !== 'ReadReceipt' ||
        ev.IsGroup === true ||
        (destino && !individual(destino)) ||
        !Array.isArray(ev.MessageIDs)
      )
        return []
      const estado = estadoEntrega(a.state ?? ev.Type)
      const nivel =
        estado === 'lida'
          ? 3
          : estado === 'entregue'
            ? 2
            : estado === 'enviada'
              ? 1
              : estado === 'falha'
                ? -1
                : 0
      const ids = ev.MessageIDs.filter((id): id is string => Boolean(campo(id)))
      return nivel && ids.length ? [{ tipo: 'recibo', ids, nivel }] : []
    }
    case 'history': {
      if (
        a.event === 'status' &&
        (a.status != null || a.request_chat != null)
      ) {
        const resultado = lerResultadoManual(a)
        return resultado ? [resultado] : []
      }
      const pedido = campo(a.request_id)
      const resultados: Aviso[] = []
      const ordem =
        typeof a.batchChunkOrder === 'number' &&
        Number.isSafeInteger(a.batchChunkOrder) &&
        a.batchChunkOrder >= 0
          ? a.batchChunkOrder
          : 0
      const terminou =
        a.event === 'status' && a.batchHistoryStatus === 'complete'
      if (
        pedido &&
        (terminou || a.event === 'messages' || a.event === 'chats')
      ) {
        resultados.push({
          tipo: 'carga',
          pedido,
          ordem,
          terminou,
        })
      }
      if (a.event === 'messages' && Array.isArray(a.messages)) {
        const mensagens = a.messages
          .map((m) => lerMensagem(m))
          .filter((m) => m !== null)
        if (mensagens.length)
          resultados.push({
            tipo: 'mensagens',
            mensagens,
            historico: true,
            pedido,
          })
      }
      if (a.event === 'chats' && Array.isArray(a.chats)) {
        const chats = a.chats
          .map((c) => lerChatWa(c, a.owner))
          .filter((c) => c !== null)
        for (const lote of lotesWa(chats))
          resultados.push({
            tipo: 'chats',
            pedido,
            chats: lote,
          })
      }
      return resultados
    }
    case 'connection': {
      const status = objeto(a.instance).status
      if (typeof status !== 'string') return []
      return [
        {
          tipo: 'conexao',
          estado: estadoRemoto(status),
          telefone:
            typeof a.owner === 'string' && /^\d{7,15}$/.test(a.owner)
              ? a.owner
              : null,
        },
      ]
    }
    case 'chats':
      return nomeChat(a.chat)
    default:
      return []
  }
}

export type EstadoNumero = 'conectado' | 'conectando' | 'desconectado'
export function estadoRemoto(estado: unknown): EstadoNumero {
  switch (estado) {
    case 'connected':
      return 'conectado'
    case 'connecting':
    case 'registering':
      return 'conectando'
    default:
      return 'desconectado'
  }
}
export const telefoneRemoto = (valor: unknown) =>
  typeof valor === 'string' && /^\d{7,15}(?:@s\.whatsapp\.net)?$/.test(valor)
    ? valor.split('@')[0]
    : null

export function lerInstancia(registro: unknown) {
  const i = objeto(registro)
  if (
    typeof i.id !== 'string' ||
    !i.id ||
    typeof i.name !== 'string' ||
    !i.name.trim() ||
    typeof i.token !== 'string' ||
    !i.token
  )
    return null
  return {
    id: i.id,
    nome: i.name,
    token: i.token,
    estado: estadoRemoto(i.status),
    telefone: telefoneRemoto(i.owner),
    operacao: i.adminField01,
  }
}

export function lerInstanciaCriada(resposta: unknown) {
  const r = objeto(resposta),
    i = objeto(r.instance)
  const instancia = lerInstancia({ ...i, token: r.token ?? i.token })
  if (!instancia) throw new UazapiErro(502)
  return instancia
}

export function lerPareamento(resposta: unknown) {
  const r = objeto(resposta),
    i = objeto(r.instance),
    status = objeto(r.status)
  const codigo =
    typeof i.paircode === 'string' ? i.paircode.replace('-', '') : ''
  return {
    estado: estadoRemoto(
      i.status ??
        (status.connected === true || r.connected === true
          ? 'connected'
          : 'disconnected'),
    ),
    telefone: telefoneRemoto(objeto(status.jid).user ?? i.owner),
    qr:
      typeof i.qrcode === 'string' &&
      /^data:image\/png;base64,[\da-z+/=]+$/i.test(i.qrcode)
        ? i.qrcode
        : null,
    codigo: /^[A-Z\d]{8}$/i.test(codigo) ? codigo : null,
  }
}
