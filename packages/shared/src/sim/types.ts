/** 模拟类型（W3 单机 → W4 起随服务器权威走 WS；结构不变） */

export type CustomerType = 'student' | 'dalvy' | 'worker' | 'tourist'

export type Intent =
  | { kind: 'price'; value: number }
  | { kind: 'restock'; honestShare: number } // 0~1，数量由余额决定
  | { kind: 'verify' } // 自证清白：花钱压烧心值
  | { kind: 'report'; target: string } // 举报对手烧心超标 → 触发抽检
  | { kind: 'smear'; target: string } // 给对手刷差评（有被抓风险）

export interface StallPublic {
  id: string
  name: string
  isPlayer: boolean
  /** 已被真人认领（false = bot 代打摊位） */
  human: boolean
  /** 真人摊主名（未认领/无名游客时缺省） */
  ownerName?: string
  price: number
  queueLen: number
  reputation: number
  heartburn: number
  closedForS: number
}

export interface MatchResult {
  revenue: number
  profit: number
  reputation: number
  served: number
  honestServed: number
  shadyServed: number
  fines: number
  score: number
  gradeKey: string
  /** W6：局末由服务器回填的段位变化（模拟核心本身不算段位） */
  rating?: { old: number; after: number }
}

/** 对局阶段：waiting = 等待开局（进邀请/等朋友），running = 营业中，ended = 打烊 */
export type SimPhase = 'waiting' | 'running' | 'ended'

export interface SimSnapshot {
  phase: SimPhase
  /** 等待开局剩余秒数：waiting 阶段由房间壳填充，其余恒 null */
  waitingLeftS: number | null
  timeS: number
  durationS: number
  money: number
  stockHonest: number
  stockShady: number
  price: number
  reputation: number
  heartburn: number
  servedTotal: number
  restockInS: number
  restockWindowLeftS: number | null
  /** 本班进货车已下单（窗口期内进过一次，弹窗据此关闭） */
  restockDone: boolean
  /** 主动动作冷却剩余秒数（本人座位） */
  reportCdLeftS: number
  smearCdLeftS: number
  stalls: StallPublic[]
  result: MatchResult | null
  version: number
}

export type SimEventKind =
  | 'restock_open'
  | 'restock_done'
  | 'restock_skipped'
  | 'surge'
  | 'inspection_pass'
  | 'inspection_fine'
  | 'bad_review'
  | 'loyal_return'
  | 'stock_out'
  | 'self_verified'
  | 'report_filed'
  | 'report_hit'
  | 'report_clean'
  | 'smear_done'
  | 'smear_caught'
  | 'ended'

export interface SimEvent {
  id: number
  kind: SimEventKind
  /** 归属座位；缺省 = 全局事件（人潮、打烊），广播给房间所有人 */
  seat?: string
  vars?: Record<string, string | number>
}
