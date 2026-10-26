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

/** 单例 DO 内的权威滑动窗口：快速匹配 10 次/分钟/IP、建房 5 次/分钟/IP（超限抛 RATE_LIMITED） */
const QUICK_MAX_PER_MIN = 10
const PRIVATE_MAX_PER_MIN = 5
const WINDOW_MS = 60_000

/**
 * MatchMaker DO（W6，全局单例 getByName('global')）：
 * - 快速匹配：30s 窗口内的第二个玩家与第一个进同一房（不齐由 bot 补位，决策 #5）
 * - 私房：发 6 位邀请码，房间号即邀请码，无需中央状态
 * - per-IP 限流：两个入口都无鉴权，这里是不让免费额度（DO 请求/连接数）被单点刷爆的闸门
 */
export class MatchMaker extends DurableObject<Env> {
  private waiting: { matchId: string; playerId: string; at: number } | null = null
  private hits = new Map<string, number[]>()

  private allow(bucket: string, max: number): boolean {
    const now = Date.now()
    const arr = (this.hits.get(bucket) ?? []).filter((t) => now - t < WINDOW_MS)
    const ok = arr.length < max
    if (ok) arr.push(now)
    this.hits.set(bucket, arr)
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) {
        if (v.every((t) => now - t >= WINDOW_MS)) this.hits.delete(k)
      }
    }
    return ok
  }

  /** 快速匹配：返回 matchId（可能已在排队等待第二个玩家） */
  async quickMatch(playerId: string, ip = 'local'): Promise<{ matchId: string; queued: boolean }> {
    if (!this.allow(`q:${ip}`, QUICK_MAX_PER_MIN)) throw new Error('RATE_LIMITED')
    const now = Date.now()
    const w = this.waiting
    if (w && now - w.at < WAIT_TTL_MS && w.playerId !== playerId) {
      this.waiting = null
      return { matchId: w.matchId, queued: false }
    }
    const matchId = `m-${code6()}`
    this.waiting = { matchId, playerId, at: now }
    return { matchId, queued: true }
  }

  /** 私房：直接发一个新邀请码 */
  async createPrivate(ip = 'local'): Promise<{ matchId: string }> {
    if (!this.allow(`p:${ip}`, PRIVATE_MAX_PER_MIN)) throw new Error('RATE_LIMITED')
    return { matchId: `p-${code6()}` }
  }

  async validate(matchId: string): Promise<boolean> {
    return MATCH_ID_RE.test(matchId)
  }
}
