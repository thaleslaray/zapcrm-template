import { DurableObject } from 'cloudflare:workers'
import { sessoesDoSetor } from './tempo-real-acesso'

export class TempoRealSetor extends DurableObject<Env> {
  fetch(request: Request) {
    const sessao = request.headers.get('x-sessao')
    const usuario = request.headers.get('x-usuario')
    if (!sessao || !usuario || request.headers.get('upgrade') !== 'websocket')
      return new Response(null, { status: 400 })
    const tag = `usuario:${usuario}`
    if (
      this.ctx.getWebSockets(tag).length >= 8 ||
      this.ctx.getWebSockets().length >= 256
    )
      return new Response(null, {
        status: 429,
        headers: { 'retry-after': '60' },
      })
    const par = new WebSocketPair()
    this.ctx.acceptWebSocket(par[1], [`sessao:${sessao}`, tag])
    return new Response(null, { status: 101, webSocket: par[0] })
  }

  async avisar() {
    const conexoes = this.ctx.getWebSockets()
    const setor = this.ctx.id.name
    if (!conexoes.length || !setor) return
    const porSessao = conexoes.map((socket) => {
      const tags = this.ctx.getTags(socket)
      const sessao =
        tags
          .find((tag) => tag.startsWith('sessao:'))
          ?.slice('sessao:'.length) ?? tags.find((tag) => !tag.includes(':'))
      return { socket, sessao }
    })
    const ids = [
      ...new Set(porSessao.flatMap((c) => (c.sessao ? [c.sessao] : []))),
    ]
    const autorizadas = await sessoesDoSetor(this.env, setor, ids)
    for (const { socket, sessao } of porSessao) {
      if (socket.readyState !== WebSocket.OPEN) continue
      if (sessao && autorizadas.has(sessao)) socket.send('mudou')
      else socket.close(1008, 'Sem acesso')
    }
  }

  webSocketMessage(socket: WebSocket) {
    socket.close(1008, 'Este canal só envia avisos.')
  }

  webSocketClose(socket: WebSocket) {
    if (socket.readyState !== WebSocket.CLOSED) socket.close()
  }
}
