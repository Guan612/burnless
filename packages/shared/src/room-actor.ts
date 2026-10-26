import type { RoomClock } from './clock'
import { PROTOCOL_VERSION, type ClientMessage, type EchoEntry, type ServerMessage } from './protocol'

export type SendFn = (msg: ServerMessage) => void

export interface RoomActorOptions {
  historyLimit?: number
}

const DEFAULT_HISTORY_LIMIT = 50
const MAX_TEXT_LENGTH = 500
/** 单连接广播节流：1s 内最多放行 5 条 echo，超出直接丢弃并回错误帧（防单点刷屏放大到全房） */
const ECHO_RATE_MAX = 5
const ECHO_RATE_WINDOW_MS = 1000

/**
 * 房间内核：全部房间逻辑都在这个纯类里——无任何 runtime 依赖，时钟注入（决策 #13）。
 * Cloudflare Durable Object 与 Node 适配器都只是它的传输壳：把 WebSocket 帧喂进来，
 * 把 ServerMessage 发出去。W3 的游戏模拟会以同样方式挂在内核里。
 */
export class RoomActor {
  private clients = new Map<string, SendFn>()
  private echoHits = new Map<string, number[]>()
  private history: EchoEntry[] = []
  private seq = 0

  constructor(
    private clock: RoomClock,
    private options: RoomActorOptions = {},
  ) {}

  get historyLimit(): number {
    return this.options.historyLimit ?? DEFAULT_HISTORY_LIMIT
  }

  join(id: string, send: SendFn): ServerMessage {
    this.clients.set(id, send)
    this.broadcastExcept(id, { type: 'joined', id, at: this.clock.now() })
    return { type: 'welcome', protocol: PROTOCOL_VERSION, you: id, history: [...this.history] }
  }

  leave(id: string): void {
    if (!this.clients.delete(id)) return
    this.echoHits.delete(id)
    this.broadcast({ type: 'left', id, at: this.clock.now() })
  }

  /** 入口：传输壳把原始帧解析结果喂进来，内核自己负责校验 */
  message(from: string, raw: unknown): void {
    const msg = parseClientMessage(raw)
    if (!msg) {
      this.clients.get(from)?.({ type: 'error', message: 'invalid message' })
      return
    }
    switch (msg.type) {
      case 'hello':
        return
      case 'echo': {
        const now = this.clock.now()
        const hits = (this.echoHits.get(from) ?? []).filter((t) => now - t < ECHO_RATE_WINDOW_MS)
        if (hits.length >= ECHO_RATE_MAX) {
          this.echoHits.set(from, hits)
          this.clients.get(from)?.({ type: 'error', message: 'too many messages' })
          return
        }
        hits.push(now)
        this.echoHits.set(from, hits)
        const entry: EchoEntry = { seq: ++this.seq, from, text: msg.text, at: now }
        this.history.push(entry)
        if (this.history.length > this.historyLimit) {
          this.history.splice(0, this.history.length - this.historyLimit)
        }
        this.broadcast({ type: 'echo', ...entry })
        return
      }
    }
  }

  private broadcast(msg: ServerMessage): void {
    for (const send of this.clients.values()) send(msg)
  }

  private broadcastExcept(exceptId: string, msg: ServerMessage): void {
    for (const [id, send] of this.clients) {
      if (id !== exceptId) send(msg)
    }
  }
}

export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== 'object' || raw === null) return null
  const m = raw as Record<string, unknown>
  if (m.type === 'hello') return { type: 'hello' }
  if (m.type === 'echo' && typeof m.text === 'string' && m.text.length > 0 && m.text.length <= MAX_TEXT_LENGTH) {
    return { type: 'echo', text: m.text }
  }
  return null
}
