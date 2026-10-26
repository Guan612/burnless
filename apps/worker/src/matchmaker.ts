import { DurableObject } from 'cloudflare:workers'

const WAIT_TTL_MS = 30_000
const MATCH_ID_RE = /^[a-zA-Z0-9_-]{1,32}$/

function code6(): string {
  // 邀请码去易混字符（0/O、1/I）
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyz'
  let s = ''
  const buf = crypto.getRandomValues(new Uint8Array(6))
  for (const b of buf) s += alphabet[b % alphabet.length]
  return s
}

/** 滑动窗口限流：快速匹配 10 次/分钟/IP、建房 5 次/分钟/IP（超限抛 RATE_LIMITED） */
const QUICK_MAX_PER_MIN = 10
const PRIVATE_MAX_PER_MIN = 5
const WINDOW_MS = 60_000
/** 桶数上限（防内存/存储膨胀：超了先清一遍全过期桶） */
const MAX_BUCKETS = 10_000

interface Waiting {
  matchId: string
  playerId: string
  at: number
}

/**
 * MatchMaker DO（W6，全局单例 getByName('global')）：
 * - 快速匹配：30s 窗口内的第二个玩家与第一个进同一房（不齐由 bot 补位，决策 #5）
 * - 私房：发 6 位邀请码，房间号即邀请码，无需中央状态
 * - per-IP 限流：两个入口都无鉴权，这里是不让免费额度（DO 请求/连接数）被单点刷爆的闸门
 *
 * 状态必须落 storage：从不写 storage 的 DO 会被运行时按「无状态」对待——随时驱逐、
 * 甚至多实例并存（线上实测同 IP 连打建房全部放行、配对状态时灵时不灵）。
 * 落库后单实例语义与计数持久才成立；内存只做写穿缓存省读放大。
 */
export class MatchMaker extends DurableObject<Env> {
  private waiting: Waiting | null = null
  private waitingLoaded = false
  private hits: Map<string, number[]> | null = null

  private async loadWaiting(): Promise<Waiting | null> {
    if (!this.waitingLoaded) {
      this.waiting = (await this.ctx.storage.get<Waiting>('waiting')) ?? null
      this.waitingLoaded = true
    }
    return this.waiting
  }

  private async allow(bucket: string, max: number): Promise<void> {
    if (!this.hits) {
      const stored = (await this.ctx.storage.get<Record<string, number[]>>('rate_hits')) ?? {}
      this.hits = new Map(Object.entries(stored))
    }
    const hits = this.hits
    const now = Date.now()
    const arr = (hits.get(bucket) ?? []).filter((t) => now - t < WINDOW_MS)
    if (arr.length >= max) throw new Error('RATE_LIMITED')
    arr.push(now)
    hits.set(bucket, arr)
    if (hits.size > MAX_BUCKETS) {
      for (const [k, v] of hits) {
        if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k)
      }
    }
    await this.ctx.storage.put('rate_hits', Object.fromEntries(hits))
  }

  /** 快速匹配：返回 matchId（可能已在排队等待第二个玩家） */
  async quickMatch(playerId: string, ip = 'local'): Promise<{ matchId: string; queued: boolean }> {
    await this.allow(`q:${ip}`, QUICK_MAX_PER_MIN)
    const now = Date.now()
    const w = await this.loadWaiting()
    if (w && now - w.at < WAIT_TTL_MS && w.playerId !== playerId) {
      this.waiting = null
      await this.ctx.storage.delete('waiting')
      return { matchId: w.matchId, queued: false }
    }
    const matchId = `m-${code6()}`
    this.waiting = { matchId, playerId, at: now }
    await this.ctx.storage.put('waiting', this.waiting)
    return { matchId, queued: true }
  }

  /** 私房：直接发一个新邀请码 */
  async createPrivate(ip = 'local'): Promise<{ matchId: string }> {
    await this.allow(`p:${ip}`, PRIVATE_MAX_PER_MIN)
    return { matchId: `p-${code6()}` }
  }

  async validate(matchId: string): Promise<boolean> {
    return MATCH_ID_RE.test(matchId)
  }
}
