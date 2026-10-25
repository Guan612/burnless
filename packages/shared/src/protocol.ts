/**
 * 线协议 v3：客户端 intent ↑ / 服务器事件 ↓。
 * 回声房（W1 链路验证）与对局房（W4 服务器权威）共用这条 union，
 * 各自的 actor 只解析自己认识的子集，非法帧回 error。
 * v3：对局新增 waiting 阶段——ClientMessage 加 start（房主提前开局），
 * match_welcome 加 host 标记，快照加 waitingLeftS。
 */
import type { SimEvent, SimSnapshot, Intent } from './sim/types'

export const PROTOCOL_VERSION = 3

/** 客户端 → 服务器 */
export type ClientMessage =
  | { type: 'hello'; player?: PlayerIdentity }
  | { type: 'echo'; text: string }
  | { type: 'intent'; intent: Intent }
  | { type: 'resume'; token: string; player?: PlayerIdentity }
  | { type: 'start' }

/** 玩家身份（W6：better-auth 匿名会话的用户 id；MVP 阶段对局层信任此字段，伪造治理留 TODO） */
export interface PlayerIdentity {
  id: string
  name?: string
}

/** 服务器 → 客户端 */
export type ServerMessage =
  | { type: 'welcome'; protocol: number; you: string; history: EchoEntry[] }
  | { type: 'joined'; id: string; at: number }
  | { type: 'left'; id: string; at: number }
  | { type: 'echo'; seq: number; from: string; text: string; at: number }
  | { type: 'error'; message: string }
  | {
      type: 'match_welcome'
      protocol: number
      /** null = 观战（房间满员） */
      seatId: string | null
      /** 续座令牌：客户端存起来，断线重连时 resume 换回同一座位 */
      seatToken?: string
      spectating: boolean
      /** 等待阶段可提前开局（首个入座者 = 房主） */
      host: boolean
      snap: SimSnapshot
    }
  | { type: 'match_joined'; seatId: string; at: number }
  | { type: 'snap'; snap: SimSnapshot }
  | { type: 'events'; events: SimEvent[] }

export interface EchoEntry {
  seq: number
  from: string
  text: string
  at: number
}

/** GET /api/healthz 响应体（REST 契约也放 shared，前后端同源） */
export interface Healthz {
  ok: boolean
  protocol: number
  ts: number
}
