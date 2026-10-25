import type { ClientMessage, ServerMessage } from '@burnless/shared'

export type WsStatus = 'connecting' | 'open' | 'closed'

export interface EchoSocketHandlers {
  onMessage(msg: ServerMessage): void
  onStatus(status: WsStatus): void
}

/** 回声房客户端：W1 保持极简，断线重连（带快照同步）在 W4 随服务器权威一起做 */
export class EchoSocket {
  private ws: WebSocket | null = null

  connect(roomId: string, handlers: EchoSocketHandlers): void {
    this.close()
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws/room/${roomId}`)
    this.ws = ws
    handlers.onStatus('connecting')

    ws.addEventListener('open', () => handlers.onStatus('open'))
    ws.addEventListener('message', (ev) => {
      try {
        handlers.onMessage(JSON.parse(String(ev.data)) as ServerMessage)
      } catch {
        // 忽略坏帧
      }
    })
    ws.addEventListener('close', () => {
      if (this.ws === ws) handlers.onStatus('closed')
    })
  }

  send(msg: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(msg))
    return true
  }

  close(): void {
    this.ws?.close()
    this.ws = null
  }
}

/** 对局房客户端（W4 服务器权威）：/ws/match/:matchId，intent 上行、快照/事件下行 */
export class MatchSocket {
  private ws: WebSocket | null = null

  connect(matchId: string, handlers: EchoSocketHandlers): void {
    this.close()
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws/match/${matchId}`)
    this.ws = ws
    handlers.onStatus('connecting')

    ws.addEventListener('open', () => handlers.onStatus('open'))
    ws.addEventListener('message', (ev) => {
      try {
        handlers.onMessage(JSON.parse(String(ev.data)) as ServerMessage)
      } catch {
        // 忽略坏帧
      }
    })
    ws.addEventListener('close', () => {
      if (this.ws === ws) handlers.onStatus('closed')
    })
  }

  send(msg: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(msg))
    return true
  }

  close(): void {
    this.ws?.close()
    this.ws = null
  }
}
