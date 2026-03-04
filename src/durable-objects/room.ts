import { DurableObject } from 'cloudflare:workers'

type RoomMessage =
  | {
      type: 'stroke'
      id: string
      color: string
      size: number
      points: Array<[number, number]>
    }
  | {
      type: 'clear'
      id: string
    }
  | {
      type: 'hello'
      id: string
      color: string
    }

interface SessionState {
  id: string
  color: string
}

export class RoomDurableObject extends DurableObject {
  private sessions: Map<WebSocket, SessionState>
  private history: Array<Extract<RoomMessage, { type: 'stroke' | 'clear' }>>
  private historyLoaded: Promise<void> | null
  private readonly historyLimit = 500

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sessions = new Map()
    this.history = []
    this.historyLoaded = null

    this.ctx.getWebSockets().forEach((ws) => {
      const attachment = ws.deserializeAttachment() as SessionState | null
      if (attachment) {
        this.sessions.set(ws, attachment)
      }
    })
  }

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade')
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 })
    }

    if (request.method !== 'GET') {
      return new Response('Expected GET', { status: 405 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    const session: SessionState = {
      id: crypto.randomUUID(),
      color: this.randomColor(),
    }

    server.serializeAttachment(session)
    this.ctx.acceptWebSocket(server)
    this.sessions.set(server, session)

    await this.loadHistory()

    server.send(
      JSON.stringify({
        type: 'hello',
        id: session.id,
        color: session.color,
      } satisfies RoomMessage),
    )


    this.history.forEach((message) => {
      server.send(JSON.stringify(message))
    })

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const text =
      typeof message === 'string' ? message : new TextDecoder().decode(message)

    let payload: RoomMessage | null = null
    try {
      payload = JSON.parse(text) as RoomMessage
    } catch {
      payload = null
    }

    if (!payload) {
      return
    }

    const session = this.sessions.get(ws)
    if (!session) {
      return
    }

    if (payload.type === 'stroke') {
      payload.id = session.id
      payload.color = session.color
    }

    if (payload.type === 'clear') {
      payload.id = session.id
      this.addToHistory(payload)
    }

    if (payload.type === 'stroke') {
      this.addToHistory(payload)
    }

    this.broadcast(payload)
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
  ): Promise<void> {
    this.sessions.delete(ws)
    ws.close(code, reason)
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('WebSocket error', error)
    this.sessions.delete(ws)
  }

  private broadcast(message: RoomMessage) {
    const data = JSON.stringify(message)
    this.sessions.forEach((_session, socket) => {
      try {
        socket.send(data)
      } catch {
        this.sessions.delete(socket)
      }
    })
  }

  private async loadHistory() {
    if (!this.historyLoaded) {
      this.historyLoaded = this.ctx.storage
        .get<Array<Extract<RoomMessage, { type: 'stroke' | 'clear' }>>>(
          'history',
        )
        .then((stored) => {
          if (stored) {
            this.history = stored
          }
        })
    }

    await this.historyLoaded
  }

  private addToHistory(
    message: Extract<RoomMessage, { type: 'stroke' | 'clear' }>,
  ) {
    this.history.push(message)
    if (this.history.length > this.historyLimit) {
      this.history.splice(0, this.history.length - this.historyLimit)
    }
    this.ctx.storage.put('history', this.history)
  }

  private randomColor() {
    const palette = [
      '#ff6b6b',
      '#f06595',
      '#cc5de8',
      '#845ef7',
      '#5c7cfa',
      '#339af0',
      '#22b8cf',
      '#20c997',
      '#51cf66',
      '#94d82d',
      '#fcc419',
      '#ff922b',
      '#ff6b6b',
      '#ffa94d',
      '#ffe066',
      '#74c0fc',
      '#63e6be',
      '#a9e34b',
      '#ffd43b',
      '#e599f7',
    ]
    return palette[Math.floor(Math.random() * palette.length)]
  }
}
