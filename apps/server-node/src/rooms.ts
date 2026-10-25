import type Database from 'better-sqlite3'
import {
  MatchActor,
  RoomActor,
  WallClock,
  nextRating,
  type SeatRating,
  type ServerMessage,
} from '@burnless/shared'
import type { WebSocket as WsSocket } from 'ws'
import { createSqliteAdapter } from './db/sqlite'

const TICK_MS = 1000
/** 服务器追帧上限：与 MatchRoom DO 同款（服务器权威的时间只慢不跳） */
const MAX_CATCHUP_S = 30

export interface RoomHostDeps {
  db: Database.Database
  newToken: () => string
  /** 全员散场且对局已结束 → 外层从注册表摘除（等价 DO 实例被驱逐） */
  onIdle: (room: NodeRoom) => void
}

/**
 * 单个房间的进程内宿主——Node 逃生舱版的 MatchRoom DO（决策 #13：RoomActor 内核一行不改，只换壳）。
 * - /ws/room/:id  → RoomActor（回声房，链路验证 / 冒烟入口）
 * - /ws/match/:id → MatchActor（服务器权威对局：模拟 + 1s tick + 结算落库）
 */
export class NodeRoom {
  private echo = new RoomActor(new WallClock())
  private match: MatchActor | null = null
  private sockets = new Map<WsSocket, { id: string; kind: 'echo' | 'match' }>()
  private ticker: ReturnType<typeof setInterval> | null = null
  private lastTick = 0
  private matchId: string | null = null

  constructor(private deps: RoomHostDeps) {}

  get idle(): boolean {
    return this.sockets.size === 0 && (!this.match || !this.match.running)
  }

  connect(url: URL, socket: WsSocket): void {
    const kind = url.pathname.startsWith('/ws/match/') ? 'match' : 'echo'
    if (kind === 'match') this.matchId ??= url.pathname.split('/').pop() ?? null
    const id = this.deps.newToken()
    this.sockets.set(socket, { id, kind })

    if (kind === 'match') {
      this.match ??= new MatchActor(new WallClock(), {
        seed: crypto.getRandomValues(new Uint32Array(1))[0]!,
        newToken: this.deps.newToken,
        // 与 MatchRoom DO 同款：等待开局（私房 60s / 快速匹配 35s 兜底，人齐或房主提前开局）
        autoStartS: (this.matchId ?? '').startsWith('p-') ? 60 : 35,
        // 与 MatchRoom DO 同款：结算落库 + 段位回填（同一份 queries，better-sqlite3 执行器）
        onEnded: async (records) => {
          const dba = createSqliteAdapter(this.deps.db)
          const seasonId = await dba.activeSeasonId(Date.now())
          const ratings: SeatRating[] = []
          for (const r of records) {
            const old = (await dba.getPlayer(r.playerId))?.rating ?? 500
            const after = nextRating(old, r.result.score)
            await dba.recordResult({
              playerId: r.playerId,
              matchId: this.matchId ?? 'unknown',
              score: r.result.score,
              revenue: r.result.revenue,
              reputation: r.result.reputation,
              gradeKey: r.result.gradeKey,
              ratingAfter: after,
              seasonId,
            })
            ratings.push({ seatId: r.seatId, old, after })
          }
          return ratings
        },
      })
      this.match.attach(id, (msg) => this.send(socket, msg))
      this.ensureTicker()
      // 与 DO 壳一致：不发欢迎帧，入座等首条 hello/resume
    } else {
      this.send(socket, this.echo.join(id, (msg) => this.send(socket, msg)))
    }

    socket.on('message', (data) => {
      let parsed: unknown = null
      try {
        parsed = JSON.parse(String(data))
      } catch {
        // 留给 actor 的 parser 判非法
      }
      if (kind === 'match') this.match?.message(id, parsed)
      else this.echo.message(id, parsed)
    })
    socket.on('close', () => this.drop(socket))
    socket.on('error', () => this.drop(socket))
  }

  private drop(socket: WsSocket): void {
    const entry = this.sockets.get(socket)
    if (!entry) return
    this.sockets.delete(socket)
    if (entry.kind === 'match') this.match?.leave(entry.id)
    else this.echo.leave(entry.id)
    if (this.idle) {
      this.stopTicker()
      this.deps.onIdle(this)
    }
  }

  private tickOnce(): void {
    const match = this.match
    if (!match || match.ended) {
      this.stopTicker()
      return
    }
    const now = Date.now()
    const dtS = Math.min((now - this.lastTick) / 1000, MAX_CATCHUP_S)
    this.lastTick = now
    match.tick(dtS, MAX_CATCHUP_S)
  }

  private ensureTicker(): void {
    if (this.ticker) return
    this.lastTick = Date.now()
    this.ticker = setInterval(() => this.tickOnce(), TICK_MS)
  }

  private stopTicker(): void {
    if (this.ticker) {
      clearInterval(this.ticker)
      this.ticker = null
    }
  }

  private send(socket: WsSocket, msg: ServerMessage): void {
    try {
      socket.send(JSON.stringify(msg))
    } catch {
      // socket 已关：close/error 回调里清理即可
    }
  }
}
