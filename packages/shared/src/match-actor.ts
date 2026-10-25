import type { RoomClock } from './clock'
import { PROTOCOL_VERSION, type ClientMessage, type PlayerIdentity, type ServerMessage } from './protocol'
import type { SendFn } from './room-actor'
import { MatchSim } from './sim/sim'
import type { Intent, MatchResult, SimSnapshot } from './sim/types'


export interface SeatResultRecord {
  seatId: string
  playerId: string
  result: MatchResult
}

export interface SeatRating {
  seatId: string
  old: number
  after: number
}

export interface MatchActorOptions {
  /** 对局种子：同 seed + 同输入序列 ⇒ 同结果（确定性，决策 #9） */
  seed: number
  seatCount?: number
  /** 座位令牌生成器（必注入：内核零环境依赖，Workers/Node 各自给 crypto.randomUUID） */
  newToken: () => string
  /**
   * 等待开局秒数：传入后对局先进 waiting 阶段——人齐自动开局、房主可提前开局（start 帧）、
   * 倒计时到点 bot 补空位兜底开局；不传 = 进房即开局（旧行为，测试与旧壳不受影响）。
   */
  autoStartS?: number
  /**
   * W6 局外闭环：对局结束时对每个带身份的真人座位回调（落库 + 段位）。
   * 返回各座位段位变化，内核回填进结算并补发最终快照。不注入则跳过（纯模拟测试）。
   */
  onEnded?: (records: SeatResultRecord[]) => Promise<SeatRating[]>
}

interface Conn {
  id: string
  send: SendFn
  /** undefined = 尚未入座（等首条 hello/resume）；null = 观战；string = 座位 id */
  seatId: string | null | undefined
}

const MAX_TOKEN_LENGTH = 100

/**
 * 对局房间内核（W4）：全部房间逻辑都在这个纯类里——无 runtime 依赖、定时器外部注入（决策 #13）。
 * 职责：座位分配 / 续座令牌 / intent 校验与应用 / 逐座位个性化快照与事件分发。
 * Cloudflare MatchRoom DO 与 Node 适配器只是它的 WebSocket 壳 + 定时器壳：
 * 壳在连接建立时 attach，按节奏调 tick(dt) 推进模拟。
 *
 * 断线重连：入座延迟到首条消息（hello 新座位 / resume 续旧座位），
 * 重连瞬间不会偷占新座位；座位认领后不回退，断线期间摊位状态原样保留。
 */
export class MatchActor {
  private sim: MatchSim
  private conns = new Map<string, Conn>()
  /** seatToken → seatId；令牌在座位首次认领时签发，永久有效（短局语义） */
  private tokens = new Map<string, string>()
  private claimed = new Set<string>()
  /** seatId → 玩家身份（结算落库用） */
  private seatPlayers = new Map<string, PlayerIdentity>()
  private endedHandled = false
  private newToken: () => string
  private onEnded?: (records: SeatResultRecord[]) => Promise<SeatRating[]>
  /** 等待开局剩余秒数（仅 waiting 阶段有效） */
  private waitingLeftS = 0
  /** 房主座位 = 首个入座者：等待期独占「开局」权 */
  private hostSeatId: string | null = null

  constructor(
    private clock: RoomClock,
    options: MatchActorOptions,
  ) {
    this.sim = new MatchSim(options.seed, options.seatCount ?? 3, options.autoStartS !== undefined ? 'waiting' : 'running')
    if (options.autoStartS !== undefined) this.waitingLeftS = options.autoStartS
    this.newToken = options.newToken
    this.onEnded = options.onEnded
  }

  get running(): boolean {
    return this.sim.phase === 'running'
  }

  /** 对局是否已打烊（传输壳据此停拍；waiting 期间也要 tick 走倒计时） */
  get ended(): boolean {
    return this.sim.phase === 'ended'
  }

  get seatIds(): string[] {
    return this.sim.stallIds
  }

  /** 快照 + 摊主名回填：sim 只知道座位认领与否，真人玩家名在壳层（seatPlayers） */
  private snapFor(viewSeatId: string | null): SimSnapshot {
    const snap = this.sim.snapshotFor(viewSeatId)
    for (const s of snap.stalls) {
      const name = this.seatPlayers.get(s.id)?.name
      if (name) s.ownerName = name
    }
    snap.waitingLeftS = this.sim.phase === 'waiting' ? Math.ceil(this.waitingLeftS) : null
    return snap
  }

  /** 传输壳：WebSocket 建立即挂载管道；入座等客户端第一条消息 */
  attach(connId: string, send: SendFn): void {
    this.conns.set(connId, { id: connId, send, seatId: undefined })
  }

  leave(connId: string): void {
    this.conns.delete(connId)
  }

  /** 入口：传输壳把原始帧解析结果喂进来，内核自己负责校验 */
  message(from: string, raw: unknown): void {
    const conn = this.conns.get(from)
    if (!conn) return
    const msg = parseMatchMessage(raw)
    if (!msg) {
      conn.send({ type: 'error', message: 'invalid message' })
      return
    }
    switch (msg.type) {
      case 'hello':
        if (conn.seatId === undefined) this.joinSeat(conn, null, msg.player)
        return
      case 'resume':
        if (conn.seatId === undefined) this.joinSeat(conn, msg.token, msg.player)
        return
      case 'intent': {
        if (typeof conn.seatId !== 'string') {
          conn.send({ type: 'error', message: 'no seat' })
          return
        }
        // 成功即回个人快照：定价滑条/进货弹窗零延迟反馈，其余客户端等下一拍
        if (this.sim.intent(conn.seatId, msg.intent)) {
          conn.send({ type: 'snap', snap: this.snapFor(conn.seatId) })
        }
        return
      }
      case 'start':
        // 房主提前开局：人还没齐也能开（空位 bot 代打）；非房主/非等待期静默忽略
        if (typeof conn.seatId === 'string' && conn.seatId === this.hostSeatId) this.beginMatch()
        return
    }
  }

  /** waiting → running；excludeConnId 的连接不发补发快照（它马上有自己的 welcome/回复） */
  private beginMatch(excludeConnId?: string): void {
    if (this.sim.phase !== 'waiting') return
    this.sim.start()
    for (const [id, conn] of this.conns) {
      if (id !== excludeConnId && conn.seatId !== undefined) {
        conn.send({ type: 'snap', snap: this.snapFor(conn.seatId ?? null) })
      }
    }
  }

  /** 传输壳定时回调：推进模拟，把全局事件 + 各座位事件、个性化快照发给已入座连接 */
  tick(dtS: number, maxDtS = 1): void {
    const wasRunning = this.sim.phase === 'running'
    // 等待期倒计时：到点 bot 补空位兜底开局（waiting 期间 sim.update 是 no-op，不影响确定性）
    if (this.sim.phase === 'waiting') {
      this.waitingLeftS = Math.max(0, this.waitingLeftS - dtS)
      if (this.waitingLeftS <= 0) this.beginMatch()
    }
    this.sim.update(dtS, maxDtS)
    const events = this.sim.drainEvents()
    const globals = events.filter((e) => !e.seat)
    for (const conn of this.conns.values()) {
      if (conn.seatId === undefined) continue
      const mine = conn.seatId ? events.filter((e) => e.seat === conn.seatId) : []
      if (globals.length + mine.length > 0) {
        conn.send({ type: 'events', events: [...globals, ...mine] })
      }
      conn.send({ type: 'snap', snap: this.snapFor(conn.seatId ?? null) })
    }
    if (wasRunning && this.sim.phase === 'ended') this.handleEnded()
  }

  /** 对局结束：把带身份的真人座位结果交给外壳落库，段位变化回填结算再补发最终快照 */
  private handleEnded(): void {
    if (this.endedHandled || !this.onEnded) return
    this.endedHandled = true
    const records: SeatResultRecord[] = []
    for (const [seatId, player] of this.seatPlayers) {
      const result = this.snapFor(seatId).result
      if (result) records.push({ seatId, playerId: player.id, result })
    }
    if (records.length === 0) return
    this.onEnded(records)
      .then((ratings) => {
        for (const r of ratings) {
          const snap = this.snapFor(r.seatId)
          if (!snap.result) continue
          snap.result.rating = { old: r.old, after: r.after }
          for (const conn of this.conns.values()) {
            if (conn.seatId === r.seatId) conn.send({ type: 'snap', snap })
          }
        }
      })
      .catch((err) => console.error('[match] onEnded failed:', err))
  }

  private joinSeat(conn: Conn, resumeToken: string | null, player?: PlayerIdentity): void {
    const resumedSeat = resumeToken ? (this.tokens.get(resumeToken) ?? null) : null
    let seatId = resumedSeat
    let token = resumeToken
    if (!seatId) {
      seatId = this.freeSeat()
      if (seatId) {
        token = this.newToken()
        this.tokens.set(token, seatId)
        this.claimed.add(seatId)
      }
    }
    if (!seatId) {
      // 满员：观战，看第一个真人摊（snapshotFor(null) 的兜底逻辑）
      conn.seatId = null
      conn.send({
        type: 'match_welcome',
        protocol: PROTOCOL_VERSION,
        seatId: null,
        spectating: true,
        host: false,
        snap: this.snapFor(null),
      })
      return
    }
    // 无效令牌自动降级为新入座：断线后对局被清（服务器重启等）也能无感开新局
    this.sim.claim(seatId)
    if (this.hostSeatId === null) this.hostSeatId = seatId
    if (player) this.seatPlayers.set(seatId, player)
    // 门牌易主：摊名直接印摊主名（无名字的游客沿用 bot 随机摊名）
    if (player?.name) this.sim.renameStall(seatId, player.name)
    conn.seatId = seatId
    // 人齐即开：先翻转阶段再发 welcome——新客的 welcome 直接带 running 快照，老客收到补发
    if (this.claimed.size >= this.sim.stallIds.length && this.sim.phase === 'waiting') {
      this.beginMatch(conn.id)
    }
    conn.send({
      type: 'match_welcome',
      protocol: PROTOCOL_VERSION,
      seatId,
      seatToken: token ?? undefined,
      spectating: false,
      host: seatId === this.hostSeatId,
      snap: this.snapFor(seatId),
    })
    this.broadcastExcept(conn.id, { type: 'match_joined', seatId, at: this.clock.now() })
  }

  private freeSeat(): string | null {
    return this.sim.randomFreeSeat()
  }

  private broadcastExcept(exceptConnId: string, msg: ServerMessage): void {
    for (const [id, conn] of this.conns) {
      if (id !== exceptConnId && conn.seatId !== undefined) conn.send(msg)
    }
  }
}

/** 对局房客户端消息解析：只认 hello / resume / intent / start（回声房消息在这里非法） */
export function parseMatchMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== 'object' || raw === null) return null
  const m = raw as Record<string, unknown>
  if (m.type === 'hello') return { type: 'hello', player: parsePlayer(m.player) }
  if (m.type === 'start') return { type: 'start' }
  if (
    m.type === 'resume' &&
    typeof m.token === 'string' &&
    m.token.length > 0 &&
    m.token.length <= MAX_TOKEN_LENGTH
  ) {
    return { type: 'resume', token: m.token, player: parsePlayer(m.player) }
  }
  if (m.type === 'intent' && typeof m.intent === 'object' && m.intent !== null) {
    const i = m.intent as Record<string, unknown>
    if (i.kind === 'price' && typeof i.value === 'number' && Number.isFinite(i.value)) {
      return { type: 'intent', intent: { kind: 'price', value: i.value } }
    }
    if (i.kind === 'restock' && typeof i.honestShare === 'number' && Number.isFinite(i.honestShare)) {
      return { type: 'intent', intent: { kind: 'restock', honestShare: i.honestShare } }
    }
    if (i.kind === 'verify') {
      return { type: 'intent', intent: { kind: 'verify' } }
    }
    if (
      (i.kind === 'report' || i.kind === 'smear') &&
      typeof i.target === 'string' &&
      i.target.length > 0 &&
      i.target.length <= 32
    ) {
      return { type: 'intent', intent: i.kind === 'report' ? { kind: 'report', target: i.target } : { kind: 'smear', target: i.target } }
    }
  }
  return null
}

/** 玩家身份解析：缺失/非法时返回 undefined（游客无身份不落库） */
function parsePlayer(v: unknown): PlayerIdentity | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const p = v as Record<string, unknown>
  if (typeof p.id !== 'string' || p.id.length === 0 || p.id.length > 64) return undefined
  const name = typeof p.name === 'string' && p.name.length > 0 && p.name.length <= 32 ? p.name : undefined
  return { id: p.id, name }
}
