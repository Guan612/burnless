import type { Intent, SimEvent, SimSnapshot } from '@burnless/shared'
import { useEffect, useRef, useState } from 'react'
import { playEventSound, sfx, type SfxName } from './sfx'
import { MatchSocket } from '../ws-client'

/** 结算段位 → 小调二选一：veteran 只留原「打烊小调」，不另加戏 */
const GRADE_JINGLES: Record<string, SfxName | null> = {
  'game.grade.apprentice': 'defeat',
  'game.grade.veteran': null,
  'game.grade.rising': 'victory',
  'game.grade.master': 'victory',
}

export interface Toast extends SimEvent {
  /** 客户端本地唯一键：同一事件可能经多路连接重复到达，不能拿事件 id 当 React key */
  uid: number
  at: number
}

export type MatchStatus = 'connecting' | 'open' | 'reconnecting'

/** 对局 id 约束：与 worker 端路由校验一致，URL 直接分享 */
export const MATCH_ID_RE = /^[a-zA-Z0-9_-]{1,32}$/

const LAST_MATCH_KEY = 'burnless.lastMatch'

export function newMatchId(): string {
  return `m-${Math.random().toString(36).slice(2, 8)}`
}

/** 本会话最近的对局 id（URL 无 ?match= 时优先恢复，tab 往返不丢局） */
export function lastMatchId(): string | null {
  const v = sessionStorage.getItem(LAST_MATCH_KEY)
  return v && MATCH_ID_RE.test(v) ? v : null
}

export interface UseMatchRoomResult {
  snap: SimSnapshot | null
  toasts: Toast[]
  send: (i: Intent) => void
  restart: () => void
  matchId: string
  status: MatchStatus
  /** 等待期的房主身份（首个入座者）：只有房主能点「开局」 */
  isHost: boolean
  /** 房主提前开局（人没齐由 bot 补位） */
  startMatch: () => void
}

/**
 * W4 服务器权威：模拟跑在 MatchRoom DO 里，本地只发 intent、收快照/事件。
 * - matchId 由 TanStack Router 的 search 参数注入（`?match=`），回写走 setMatchId（路由导航）
 * - 断线自动重连（指数退避），重连时用 seatToken 续座 → 刷新页面无感续玩（W4 验收）
 * - 性能优化（决策 #21）全交 React Compiler：这里禁写 useMemo/useCallback
 */
export function useMatchRoom(
  matchId: string,
  setMatchId: (id: string) => void,
  playerId: string,
  playerName: string,
): UseMatchRoomResult {
  const [snap, setSnap] = useState<SimSnapshot | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [status, setStatus] = useState<MatchStatus>('connecting')
  const [isHost, setIsHost] = useState(false)
  const socketRef = useRef<MatchSocket | null>(null)
  // 身份用原始类型进依赖，避免对象字面量每渲染都重连（React Compiler 兜底）
  const identity = { id: playerId, name: playerName }

  useEffect(() => {
    if (!matchId) return
    const tokenKey = `burnless.seat.${matchId}`
    sessionStorage.setItem(LAST_MATCH_KEY, matchId)
    let disposed = false
    let retryTimer: number | undefined
    let retries = 0
    // 事件去重：多路连接（开发态）或重连竞态会把同一事件送到两次；
    // 事件 id 在对局内单调递增，只认更新的
    let lastEventId = 0
    let toastSeq = 0
    /** 本人快照里 servedTotal 的上次值：增量触发进账音（每秒一拍，多单并作一声） */
    let prevServed: number | null = null
    // 一局各只放一次：开局号角（仅新开对局，重连/观战不打扰）与结算小调
    let startJingled = false
    let resultJingled = false

    const connect = () => {
      if (disposed) return
      window.clearTimeout(retryTimer)
      socketRef.current?.close()
      setStatus(retries === 0 ? 'connecting' : 'reconnecting')
      const socket = new MatchSocket()
      socketRef.current = socket
      socket.connect(matchId, {
        onStatus: (ws) => {
          if (disposed) return
          // 只在真正 closed 时重连。注意 'connecting' 会在 connect() 内同步回调，
          // 绝不能当成断线——否则每次连接都会 schedule 一次重连（W4 实测 1 次/秒的连接风暴）
          if (ws === 'connecting') return
          if (ws === 'open') {
            retries = 0
            // 先续座再入座：有令牌用令牌，没有就 hello 领新座（带身份，结算落库用）
            const token = sessionStorage.getItem(tokenKey)
            socket.send(token ? { type: 'resume', token, player: identity } : { type: 'hello', player: identity })
            return
          }
          setStatus('reconnecting')
          const delay = Math.min(1000 * 2 ** Math.min(retries++, 3), 5000)
          retryTimer = window.setTimeout(connect, delay)
        },
        onMessage: (msg) => {
          if (msg.type === 'match_welcome') {
            if (msg.seatToken) sessionStorage.setItem(tokenKey, msg.seatToken)
            setIsHost(msg.host === true)
            setSnap(msg.snap)
            setStatus('open')
            // 刚开张的对局（模拟起步 2s 内）用开市号角顶替入座音；重连/中途加入/等待房仍走旧音
            if (!startJingled && msg.snap.phase === 'running' && msg.snap.timeS < 2) {
              startJingled = true
              sfx.play('match_start')
            } else {
              sfx.play('join')
            }
            return
          }
          if (msg.type === 'match_joined') {
            sfx.play('join')
            return
          }
          if (msg.type === 'snap') {
            if (msg.snap.phase === 'running' && prevServed !== null && msg.snap.servedTotal > prevServed) sfx.play('coin')
            prevServed = msg.snap.servedTotal
            // 等待房 → 开局翻转：号角在这里响（welcome 还是 waiting，走不到上面那个分支）
            if (!startJingled && msg.snap.phase === 'running' && msg.snap.timeS < 2) {
              startJingled = true
              sfx.play('match_start')
            }
            if (!resultJingled && msg.snap.phase === 'ended' && msg.snap.result) {
              resultJingled = true
              const jingle = GRADE_JINGLES[msg.snap.result.gradeKey]
              if (jingle) sfx.play(jingle)
            }
            setSnap(msg.snap)
            return
          }
          if (msg.type === 'events') {
            const fresh = msg.events.filter((e) => e.id > lastEventId)
            if (fresh.length === 0) return
            lastEventId = fresh[fresh.length - 1]!.id
            for (const e of fresh) playEventSound(e.kind)
            const now = Date.now()
            const withMeta = fresh.map((e) => ({ ...e, uid: ++toastSeq, at: now }))
            setToasts((prev) => [...prev, ...withMeta].slice(-4))
            return
          }
          if (msg.type === 'error') console.warn('[match]', msg.message)
        },
      })
    }
    connect()

    // toast 过期清理（本地没有模拟循环可搭车，单开 1s 一拍）
    const prune = window.setInterval(() => {
      setToasts((prev) => {
        const now = Date.now()
        const kept = prev.filter((e) => now - e.at < 6000)
        return kept.length === prev.length ? prev : kept
      })
    }, 1000)

    return () => {
      disposed = true
      socketRef.current?.close()
      socketRef.current = null
      window.clearInterval(prune)
      window.clearTimeout(retryTimer)
      setSnap(null)
      setToasts([])
    }
  }, [matchId, playerId, playerName])

  const send = (i: Intent) => {
    socketRef.current?.send({ type: 'intent', intent: i })
  }

  const startMatch = () => {
    socketRef.current?.send({ type: 'start' })
  }

  const restart = () => setMatchId(newMatchId())

  return { snap, toasts, send, restart, matchId: matchId ?? '', status, isHost, startMatch }
}
