import { DurableObject } from 'cloudflare:workers'
import {
  MatchActor,
  RoomActor,
  WallClock,
  nextRating,
  type SeatRating,
  type ServerMessage,
} from '@burnless/shared'
import { createD1Adapter } from './db/d1'

const TICK_MS = 1000
/** 服务器追帧上限：DO 被 CPU 饿超过 30s 的部分直接丢弃（服务器权威的时间只慢不跳） */
const MAX_CATCHUP_S = 30

/**
 * MatchRoom DO：两个 RoomActor 纯类的 Cloudflare 传输壳（决策 #9 / #13）。
 * - /ws/room/:id  → RoomActor（W1 回声房，链路验证 / 冒烟测试入口）
 * - /ws/match/:id → MatchActor（W4 服务器权威对局：一局一 DO，模拟 + tick 全在此）
 *
 * tick 用内存 setInterval 驱动（1s 一拍）：对局是内存态（W1 短局语义，断光即释放），
 * 存储 alarm 反而会把升级路径拖进 SQLite 写锁争用（实测 SQLITE_BUSY 把 101 打挂）。
 * 注意 workerd 里纯 JS 定时器不能阻止 DO 驱逐：全员断线 ~10s 后 DO 连状态带定时器一起被回收，
 * 「对局继续跑」只在至少一条连接存活时成立；挂机续命需要 storage alarm + 状态快照（W7 评估）。
 * isolate 回收 = 对局消散，客户端凭无效令牌自动降级开新座（MatchActor.resume 的兜底）。
 */
export class MatchRoom extends DurableObject<Env> {
  private echo = new RoomActor(new WallClock())
  private match: MatchActor | null = null
  private sockets = new Map<WebSocket, { id: string; kind: 'echo' | 'match' }>()
  private ticker: ReturnType<typeof setInterval> | null = null
  private lastTick = 0

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected websocket upgrade', { status: 426 })
    }
    const kind = new URL(request.url).pathname.startsWith('/ws/match/') ? 'match' : 'echo'
    if (kind === 'match') {
      // 房间号即 match_id（落库用）
      this.matchIdCache ??= new URL(request.url).pathname.split('/').pop() ?? null
    }

    const pair = new WebSocketPair()
    const server = pair[1]
    const id = crypto.randomUUID()

    server.accept()
    this.sockets.set(server, { id, kind })

    if (kind === 'match') {
      this.match ??= new MatchActor(new WallClock(), {
        seed: crypto.getRandomValues(new Uint32Array(1))[0]!,
        newToken: () => crypto.randomUUID(),
        // 等待开局：私房先发链接等朋友（60s 兜底），快速匹配等配对对手落座（30s 窗口 + 登陆余量）；
        // 人齐自动开局，房主可提前开局，空位由 bot 代打
        autoStartS: (this.matchIdCache ?? '').startsWith('p-') ? 60 : 35,
        // W6 局外闭环：结算落库 + 段位回填（queries 模块，决策 #13 缝）
        onEnded: async (records) => {
          const db = createD1Adapter(this.env.DB)
          const seasonId = await db.activeSeasonId(Date.now())
          const ratings: SeatRating[] = []
          for (const r of records) {
            const old = (await db.getPlayer(r.playerId))?.rating ?? 500
            const after = nextRating(old, r.result.score)
            await db.recordResult({
              playerId: r.playerId,
              matchId: this.matchIdCache ?? 'unknown',
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
      this.match.attach(id, (msg) => this.send(server, msg))
      this.ensureTicker()
      // match 房不发欢迎帧：入座等首条 hello/resume（防重连瞬占新座位），welcome 由 actor 回
    } else {
      this.send(server, this.echo.join(id, (msg) => this.send(server, msg)))
    }

    server.addEventListener('message', (event) => {
      let parsed: unknown = null
      try {
        parsed = JSON.parse(String(event.data))
      } catch {
        // 留给 actor 的 parser 判非法
      }
      if (kind === 'match') this.match?.message(id, parsed)
      else this.echo.message(id, parsed)
    })
    server.addEventListener('close', () => this.drop(server))
    server.addEventListener('error', () => this.drop(server))

    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  /** 房间号（落库 match_id 用）：首个连接的 URL 段 */
  private matchIdCache: string | null = null

  /** 服务器 tick：推进 MatchActor；打烊即停拍（waiting 阶段也照拍，倒计时靠它走） */
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

  private drop(socket: WebSocket): void {
    const entry = this.sockets.get(socket)
    if (!entry) return
    this.sockets.delete(socket)
    if (entry.kind === 'match') this.match?.leave(entry.id)
    else this.echo.leave(entry.id)
  }

  private send(socket: WebSocket, msg: ServerMessage): void {
    try {
      socket.send(JSON.stringify(msg))
    } catch {
      // socket 已关：close/error 回调里清理即可
    }
  }
}
