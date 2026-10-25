import { randomBytes } from 'node:crypto'

const WAIT_TTL_MS = 30_000

function code6(): string {
  // 邀请码去易混字符（0/O、1/I）——与 worker 的 MatchMaker DO 同款
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyz'
  const buf = randomBytes(6)
  let s = ''
  for (const b of buf) s += alphabet[b % alphabet.length]
  return s
}

/** 进程内匹配器：语义对齐 MatchMaker DO（30s 窗口凑人，不齐 bot 补位；私房 6 位邀请码） */
export class NodeMatchMaker {
  private waiting: { matchId: string; playerId: string; at: number } | null = null

  quickMatch(playerId: string): { matchId: string; queued: boolean } {
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

  createPrivate(): { matchId: string } {
    return { matchId: `p-${code6()}` }
  }
}
