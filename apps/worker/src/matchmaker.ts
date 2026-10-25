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

/**
 * MatchMaker DO（W6，全局单例 getByName('global')）：
 * - 快速匹配：30s 窗口内的第二个玩家与第一个进同一房（不齐由 bot 补位，决策 #5）
 * - 私房：发 6 位邀请码，房间号即邀请码，无需中央状态
 */
export class MatchMaker extends DurableObject<Env> {
  private waiting: { matchId: string; playerId: string; at: number } | null = null

  /** 快速匹配：返回 matchId（可能已在排队等待第二个玩家） */
  async quickMatch(playerId: string): Promise<{ matchId: string; queued: boolean }> {
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
  async createPrivate(): Promise<{ matchId: string }> {
    return { matchId: `p-${code6()}` }
  }

  async validate(matchId: string): Promise<boolean> {
    return MATCH_ID_RE.test(matchId)
  }
}
