// Transporte local usado pelo Playwright. O controle representa ações do celular.
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'

const origem = 'http://127.0.0.1:3233'
const tokenAdmin = process.env.UAZAPI_ADMIN_TOKEN
if (process.env.UAZAPI_URL !== origem || !tokenAdmin) {
  throw new Error(
    'Configure a uazapi de teste na porta local 3233 em .dev.vars.',
  )
}
const destinoAvisos = new URL(
  `http://localhost:${process.env.E2E_PORT || '3230'}`,
).origin
const instancias = []
const limitesCriacao = new Set()
const limitesConexao = new Set()
const arquivos = new Map(
  Object.entries({
    foto: ['telhado.png', 'image/png'],
    avatar: ['avatar.jpg', 'image/jpeg'],
    audio: ['audio.mp3', 'audio/mpeg'],
    documento: ['proposta.pdf', 'application/pdf'],
  }),
)
const qr =
  'data:image/png;base64,' +
  readFileSync(new URL('qr.png', import.meta.url)).toString('base64')
function criar(name, status, adminField01) {
  const dados = {
    id: randomUUID(),
    token: randomUUID(),
    name,
    status,
    owner: '551140028922',
    adminField01,
  }
  const cadastro = {
    dados,
    avisos: null,
    falhas: [],
    tempos: [],
    mensagens: [],
    chats: new Map(),
    pedidos: new Map(),
    sequencia: 0,
    chamadas: [],
    midias: new Map(),
    falharEnvio: false,
    ecoPausado: false,
    requestId: null,
  }
  instancias.push(cadastro)
  return cadastro
}
async function avisar(cadastro, evento) {
  if (!cadastro.avisos?.enabled) throw new Error('Avisos desativados')
  const inicio = Date.now()
  const corpo = JSON.stringify({
    ...evento,
    instanceName: cadastro.dados.name,
    owner: cadastro.dados.owner,
    token: cadastro.dados.token,
    BaseUrl: origem,
  })
  const resposta = await fetch(cadastro.avisos.url, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    headers: { 'content-type': 'application/json' },
    body: corpo,
  }).catch(() => null)
  const health = cadastro.avisos.health
  cadastro.tempos.push(Date.now() - inicio)
  if (cadastro.tempos.length > 100) cadastro.tempos.shift()
  const tempos = cadastro.tempos.toSorted((a, b) => a - b)
  health.sample = tempos.length
  health.avgMs = Math.round(
    tempos.reduce((soma, ms) => soma + ms, 0) / tempos.length,
  )
  health.p95Ms = tempos[Math.ceil(tempos.length * 0.95) - 1]
  health.timeouts = tempos.filter((ms) => ms >= 30_000).length
  if (resposta?.ok) {
    health.status =
      health.timeouts || health.avgMs > 5000
        ? 'very_slow'
        : health.avgMs >= 1000
          ? 'slow'
          : 'ok'
    health.lastSuccessAt = new Date().toISOString()
    health.failCount = 0
    delete health.lastError
    delete health.failingSince
  } else {
    health.status = 'failing'
    health.lastError = `${evento.EventType}: falha na entrega.`
    health.failingSince ??= new Date().toISOString()
    health.failCount++
    if (
      health.failCount >= 10 &&
      inicio - Date.parse(health.failingSince) >= 86_400_000
    ) {
      cadastro.avisos.enabled = false
      health.status = 'disabled'
      health.autoDisabledAt = new Date().toISOString()
    }
    cadastro.falhas.unshift({
      created: new Date().toISOString(),
      webhook_id: cadastro.avisos.id,
      url: cadastro.avisos.url,
      type: 'local',
      event: evento.EventType,
      messageid:
        evento.message?.messageid ?? evento.event?.MessageIDs?.[0] ?? '',
      attempts: 1,
      ...(resposta ? { status_code: resposta.status } : {}),
      ...(evento.EventType === 'messages'
        ? {}
        : {
            delivery_id: randomUUID(),
            payload: {
              EventType: evento.EventType,
              payloadSize: Buffer.byteLength(corpo),
              payload_truncated: true,
              ...(Array.isArray(evento.event?.MessageIDs)
                ? { event: { MessageIDs: evento.event.MessageIDs.slice(0, 8) } }
                : {}),
            },
          }),
      error: 'Falha na entrega.',
      stage: 'http',
    })
  }
  return resposta?.status ?? 0
}
function guardarChats(item, chats) {
  for (const chat of chats) item.chats.set(chat.wa_chatid, chat)
}

// O controle do celular libera os lotes em chamadas separadas da aceitação
// do pedido. Assim o navegador observa o estado pendente sem temporizadores.
async function entregarHistorico(item, requestId, lotes, resultado = {}) {
  const envelope = {
    EventType: 'history',
    request_id: requestId,
    batchNumber: 1,
    batchTotal: 1,
    batchChunkOrder: ++item.sequencia,
  }
  for (const [event, registros] of Object.entries(lotes)) {
    if (!registros.length) continue
    const status = await avisar(item, {
      ...envelope,
      event,
      [event]: registros,
      batchHistoryStatus: 'loading',
    })
    if (status !== 200) return status
  }
  return avisar(item, {
    ...envelope,
    event: 'status',
    batchHistoryStatus: 'complete',
    ...resultado,
  })
}

const servidor = createServer(async (req, res) => {
  const responder = (status, dados) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(dados))
  }
  try {
    const urlPedido = new URL(req.url, origem)
    const caminho = urlPedido.pathname
    if (req.method === 'GET' && caminho === '/status') {
      const agora = new Date().toISOString()
      const contagens = {
        connected: 0,
        reconnecting: 0,
        connecting: 0,
        queued_reconnect: 0,
        disconnected: 0,
        hibernated: 0,
        other: 0,
      }
      for (const { dados } of instancias) {
        contagens[
          Object.hasOwn(contagens, dados.status) ? dados.status : 'other'
        ]++
      }
      return responder(200, {
        info: 'Servidor local de teste',
        build: { version: '3.0.0', revision: 'local', date: '2026-11-19' },
        instance_counts: {
          ...contagens,
          total: instancias.length,
          observed_at: agora,
        },
        status: {
          server_status: 'running',
          total_instances: instancias.length,
          last_check: agora,
          dc: 'local',
          node: 'local',
        },
      })
    }
    if (req.method === 'GET' && caminho.startsWith('/arquivo/')) {
      const expira = urlPedido.searchParams.get('oe')
      if (expira && Number.parseInt(expira, 16) * 1000 <= Date.now())
        return responder(410, {})
      const chave = caminho.slice('/arquivo/'.length)
      const arquivo = arquivos.get(chave)
      const envio = instancias.map((i) => i.midias.get(chave)).find(Boolean)
      if (!arquivo && !envio) return responder(404, {})
      const dados =
        envio?.bytes ?? readFileSync(new URL(arquivo[0], import.meta.url))
      res.writeHead(200, {
        'Content-Type': envio?.mime ?? arquivo[1],
        'Content-Length': dados.length,
      })
      return res.end(dados)
    }
    const admin = req.headers.admintoken === tokenAdmin
    const instancia = instancias.find(
      (i) => i.dados.token === req.headers.token,
    )
    if (!admin && !instancia) return responder(401, {})
    const partes = []
    for await (const parte of req) partes.push(parte)
    const corpo = partes.length ? JSON.parse(Buffer.concat(partes)) : {}
    if (caminho.startsWith('/teste/')) {
      if (!admin || req.method !== 'POST') return responder(403, {})
      if (caminho === '/teste/limitar-pareamento') {
        limitesCriacao.add(corpo.nome)
        limitesConexao.add(corpo.nome)
        return responder(200, {})
      }
      if (caminho === '/teste/preparar') {
        const item = criar(corpo.nome, 'connected')
        item.mensagens.push(...(corpo.mensagens ?? []))
        guardarChats(item, corpo.chats ?? [])
        return responder(201, { id: item.dados.id })
      }
      const item = instancias.find((i) => i.dados.name === corpo.nome)
      if (!item) return responder(404, {})
      if (caminho === '/teste/parear' || caminho === '/teste/guardar') {
        const chats = corpo.chats ?? []
        const messages = corpo.mensagens ?? []
        guardarChats(item, chats)
        item.mensagens.push(...messages)
        if (caminho === '/teste/guardar') return responder(200, {})
        if (!item.requestId || item.dados.status !== 'connecting')
          return responder(409, {})
        item.dados.status = 'connected'
        const conexao = await avisar(item, {
          EventType: 'connection',
          instance: { status: 'connected' },
        })
        if (conexao !== 200) return responder(502, {})
        const status = await entregarHistorico(item, item.requestId, {
          chats,
          messages,
        })
        return responder(status, {})
      }
      if (caminho === '/teste/entregar-anteriores') {
        const pedido = item.pedidos.get(corpo.chat)
        if (!pedido) return responder(409, {})
        const messages = (corpo.mensagens ?? []).map((m) => ({
          ...m,
          chatid: corpo.chat,
          request_id: pedido.requestId,
        }))
        item.mensagens.push(...messages)
        const status = await entregarHistorico(
          item,
          pedido.requestId,
          { messages },
          {
            request_chat: corpo.chat,
            received_messages: messages.length,
            next_request: null,
            ...corpo.resultado,
          },
        )
        if (status === 200) item.pedidos.delete(corpo.chat)
        return responder(status, { pedido })
      }
      if (caminho === '/teste/remover') {
        instancias.splice(instancias.indexOf(item), 1)
        return responder(200, {})
      }
      if (caminho === '/teste/inspecionar') {
        const midias = Array.from(
          item.midias.values(),
          ({ tipo, mime, bytes, nome }) => ({
            tipo,
            mime,
            nome,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          }),
        )
        return responder(200, { ...item, midias })
      }
      if (caminho === '/teste/pausar-eco') {
        item.ecoPausado = true
        return responder(200, {})
      }
      if (caminho === '/teste/falhar-envio') {
        item.falharEnvio = true
        return responder(200, {})
      }
      if (caminho === '/teste/avisar') {
        const evento = corpo.evento
        if (evento.event === 'chats') guardarChats(item, evento.chats ?? [])
        if (evento.EventType === 'connection')
          item.dados.status = evento.instance.status
        if (evento.EventType === 'messages' || evento.EventType === 'history') {
          const lote = evento.message
            ? [evento.message]
            : (evento.messages ?? [])
          for (const msg of lote) {
            if (!item.mensagens.some((m) => m.messageid === msg.messageid))
              item.mensagens.push(msg)
          }
        }
        return responder(200, {
          status: await avisar(item, { request_id: item.requestId, ...evento }),
        })
      }
    }
    if (caminho === '/instance/all' && req.method === 'GET' && admin)
      return responder(
        200,
        instancias.map((i) => i.dados),
      )
    if (caminho === '/instance/create' && req.method === 'POST' && admin) {
      if (limitesCriacao.delete(corpo.name)) return responder(429, {})
      const { dados } = criar(corpo.name, 'disconnected', corpo.adminField01)
      return responder(200, {
        instance: dados,
        token: dados.token,
        name: dados.name,
      })
    }
    if (!instancia) return responder(401, {})
    instancia.chamadas.push(caminho)
    const { dados } = instancia
    const estado = () => ({
      connected: dados.status === 'connected',
      loggedIn: dados.status === 'connected',
      jid:
        dados.status === 'connected'
          ? { user: dados.owner, server: 's.whatsapp.net' }
          : null,
    })
    if (caminho === '/webhook' && ['GET', 'POST'].includes(req.method)) {
      if (req.method === 'POST') {
        if ('retries' in corpo || 'health' in corpo) return responder(400, {})
        if (
          corpo.action &&
          (corpo.action !== 'update' || corpo.id !== instancia.avisos?.id)
        )
          return responder(400, {})
        const url = new URL(corpo.url)
        if (
          url.origin !== destinoAvisos ||
          !url.pathname.startsWith('/api/whatsapp/aviso/')
        )
          return responder(400, {})
        instancia.tempos = []
        instancia.avisos = {
          id: instancia.avisos?.id ?? randomUUID(),
          enabled: corpo.enabled ?? false,
          url: corpo.url,
          events: corpo.events ?? [],
          excludeMessages: corpo.excludeMessages ?? [],
          addUrlEvents: corpo.addUrlEvents ?? false,
          addUrlTypesMessages: corpo.addUrlTypesMessages ?? false,
          health: {
            status: 'unknown',
            avgMs: 0,
            p95Ms: 0,
            avgQueueWaitMs: 0,
            timeouts: 0,
            sample: 0,
            failCount: 0,
            since: new Date().toISOString(),
          },
        }
      }
      return responder(200, instancia.avisos ? [instancia.avisos] : [])
    }
    if (caminho === '/instance/status' && req.method === 'GET')
      return responder(200, { instance: dados, status: estado() })
    if (caminho === '/instance/connect' && req.method === 'POST') {
      if (limitesConexao.delete(dados.name)) {
        res.setHeader('Retry-After', '17')
        return responder(429, {})
      }
      if (!instancia.avisos?.enabled) return responder(409, {})
      dados.status = 'connecting'
      dados.qrcode = corpo.phone ? '' : qr
      dados.paircode = corpo.phone ? '12345678' : ''
      instancia.sequencia = 0
      instancia.requestId = randomUUID()
      instancia.dias = corpo.history_days
      return responder(200, {
        instance: dados,
        ...estado(),
        request_id: instancia.requestId,
      })
    }
    if (caminho === '/instance/disconnect' && req.method === 'POST') {
      dados.status = 'disconnected'
      return responder(200, { instance: dados, response: 'Disconnected' })
    }
    const enviaMidia = caminho === '/send/media'
    if ((caminho === '/send/text' || enviaMidia) && req.method === 'POST') {
      if (instancia.falharEnvio) {
        instancia.falharEnvio = false
        return responder(429, {})
      }
      if (dados.status !== 'connected') return responder(409, {})
      const messageid = randomUUID()
      const tipoMensagem = {
        image: 'ImageMessage',
        video: 'VideoMessage',
        videoplay: 'VideoMessage',
        ptv: 'PTVMessage',
        sticker: 'StickerMessage',
        document: 'DocumentMessage',
        audio: 'AudioMessage',
        ptt: 'AudioMessage',
        myaudio: 'AudioMessage',
      }
      if (enviaMidia) {
        // O CRM escolheu o transporte privado em base64 cru documentado pela uazapi.
        if (
          !Object.hasOwn(tipoMensagem, corpo.type) ||
          typeof corpo.file !== 'string' ||
          !corpo.file ||
          !/^[A-Za-z0-9+/]+=*$/.test(corpo.file)
        )
          return responder(415, {})
        const bytes = Buffer.from(corpo.file, 'base64')
        if (bytes.toString('base64') !== corpo.file) return responder(400, {})
        instancia.midias.set(messageid, {
          bytes,
          tipo: corpo.type,
          mime: corpo.mimetype,
          nome: corpo.docName,
        })
      }
      const msg = {
        id: `${dados.owner}:${messageid}`,
        messageid,
        chatid: corpo.number.includes('@')
          ? corpo.number
          : `${corpo.number}@s.whatsapp.net`,
        fromMe: true,
        wasSentByApi: true,
        text: corpo.text,
        messageType: enviaMidia ? tipoMensagem[corpo.type] : 'Conversation',
        ...(enviaMidia
          ? {
              content: {
                mimetype: corpo.mimetype,
                fileName: corpo.docName,
                caption: corpo.text,
              },
            }
          : {}),
        messageTimestamp: Date.now(),
        track_source: corpo.track_source,
        track_id: corpo.track_id,
        status: 'Sent',
      }
      instancia.mensagens.push(msg)
      // O eco pode chegar antes da resposta de envio.
      if (!instancia.ecoPausado)
        await avisar(instancia, { EventType: 'messages', message: msg })
      return responder(200, { ...msg, response: { status: 'success' } })
    }
    if (caminho === '/message/find' && req.method === 'POST') {
      const todas = instancia.mensagens
        .filter(
          (m) =>
            (!corpo.id || corpo.id === m.messageid || corpo.id === m.id) &&
            (!corpo.track_source || corpo.track_source === m.track_source) &&
            (!corpo.track_id || corpo.track_id === m.track_id) &&
            (!corpo.chatid || corpo.chatid === m.chatid),
        )
        .sort((a, b) => b.messageTimestamp - a.messageTimestamp)
      const inicio = corpo.offset ?? 0
      const fim = inicio + (corpo.limit ?? 100)
      return responder(200, {
        messages: todas.slice(inicio, fim),
        pagination: {
          limit: corpo.limit ?? 100,
          offset: inicio,
          hasMore: fim < todas.length,
          nextOffset: fim,
        },
      })
    }
    if (caminho === '/message/download' && req.method === 'POST') {
      const msg = instancia.mensagens.find(
        (m) => m.id === corpo.id || m.messageid === corpo.id,
      )
      const enviado = instancia.midias.get(msg?.messageid)
      if (enviado)
        return responder(200, {
          fileURL: `${origem}/arquivo/${msg.messageid}`,
          mimetype: enviado.mime,
        })
      const tipo = {
        ImageMessage: 'foto',
        AudioMessage: 'audio',
        DocumentMessage: 'documento',
      }[msg?.messageType]
      if (!tipo) return responder(404, {})
      return responder(200, {
        fileURL: `${origem}/arquivo/${tipo}`,
        mimetype: arquivos.get(tipo)[1],
      })
    }
    if (caminho === '/webhook/errors' && req.method === 'GET') {
      const desde = Date.now() - 86_400_000
      let mensagens = 0
      let outros = 0
      return responder(
        200,
        instancia.falhas.filter(
          (f) =>
            Date.parse(f.created) >= desde &&
            (f.event === 'messages' ? ++mensagens <= 100 : ++outros <= 20),
        ),
      )
    }
    if (caminho === '/chat/avatar' && req.method === 'POST') {
      if (typeof corpo.number !== 'string' || !corpo.number.trim())
        return responder(400, {})
      const chat = [...instancia.chats.values()].find((c) =>
        [c.wa_chatid, c.wa_chatlid, c.wa_chatid?.split('@')[0]].includes(
          corpo.number,
        ),
      )
      const imagem = corpo.preview
        ? chat?.imagePreview || chat?.image
        : chat?.image || chat?.imagePreview
      if (!imagem) return responder(200, { url: '' })
      const url = new URL(imagem)
      url.searchParams.set(
        'oe',
        Math.floor(Date.now() / 1000 + 86_400).toString(16),
      )
      return responder(200, { url: url.href })
    }
    if (caminho === '/chat/find' && req.method === 'POST') {
      const todos = new Map(instancia.chats)
      for (const m of instancia.mensagens) {
        // Um snapshot explícito pode estar atrasado em relação ao histórico.
        if (instancia.chats.has(m.chatid)) continue
        const ultimo = todos.get(m.chatid)
        if (ultimo && ultimo.wa_lastMsgTimestamp > m.messageTimestamp) continue
        const fone = m.chatid.split('@')[0]
        todos.set(m.chatid, {
          wa_chatid: m.chatid,
          wa_isGroup: m.isGroup ?? false,
          phone: fone.replace(/^55(\d{2})(\d{4,5})(\d{4})$/, '+55 $1 $2-$3'),
          owner: dados.owner,
          image: '',
          imagePreview: '',
          wa_lastMessageSender: m.fromMe ? dados.owner : m.chatid,
          wa_lastMessageType: m.messageType,
          wa_lastMessageTextVote: m.text ?? '',
          wa_lastMsgTimestamp: m.messageTimestamp,
          wa_unreadCount: 0,
        })
      }
      let lista = [...todos.values()]
      if (corpo.wa_isGroup === false) lista = lista.filter((c) => !c.wa_isGroup)
      if (corpo.sort === '+wa_chatid')
        lista.sort((a, b) => a.wa_chatid.localeCompare(b.wa_chatid))
      if (corpo.sort === '-wa_lastMsgTimestamp')
        lista.sort(
          (a, b) => (b.wa_lastMsgTimestamp ?? 0) - (a.wa_lastMsgTimestamp ?? 0),
        )
      const offset = corpo.offset ?? 0
      const limit = corpo.compact
        ? Math.min(corpo.limit || 100, 200)
        : corpo.limit || 2000
      const nextOffset = offset + limit
      return responder(200, {
        chats: lista.slice(offset, nextOffset),
        pagination: {
          totalRecords: lista.length,
          offset,
          limit,
          hasMore: nextOffset < lista.length,
          nextOffset,
        },
      })
    }
    if (caminho === '/message/history-sync' && req.method === 'POST') {
      if (dados.status !== 'connected') return responder(409, {})
      if (
        !corpo.number ||
        !Number.isInteger(corpo.count) ||
        corpo.count < 1 ||
        corpo.count > 100
      )
        return responder(400, {})
      let ativo = instancia.pedidos.get(corpo.number)
      if (
        corpo.requestId &&
        [...instancia.pedidos.values()].some(
          (p) => p.requestId === corpo.requestId,
        )
      )
        return responder(409, {})
      if (ativo && ativo.messageid !== corpo.messageid) {
        await entregarHistorico(
          instancia,
          ativo.requestId,
          {},
          {
            request_chat: corpo.number,
            received_messages: 0,
            status: 'timeout',
            has_more: null,
            next_request: null,
          },
        )
        ativo = null
      }
      const pedido = ativo ?? {
        ...corpo,
        requestId: corpo.requestId || randomUUID(),
      }
      instancia.pedidos.set(corpo.number, pedido)
      return responder(200, {
        request_id: pedido.requestId,
        success: true,
        details: { result_timeout_ms: 120000, reused: !!ativo },
      })
    }
    if (caminho === '/chat/read' && req.method === 'POST')
      return responder(200, {})
    return responder(404, {})
  } catch {
    return responder(400, { erro: 'Pedido de teste inválido' })
  }
})
servidor.listen(3233, '127.0.0.1')
