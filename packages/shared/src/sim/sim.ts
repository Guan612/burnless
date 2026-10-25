/**
 * MatchSim —— 确定性对局模拟核心（W4 起跑在 MatchRoom DO，服务器权威）。
 * 固定步长 0.1s：update(dtReal) 内部按步推进，同 seed + 同输入序列（座位认领 / intent）⇒ 同结果。
 * W5：所有座位都是完整经济（钱包/库存/口碑/烧心/进货周期）；未认领座位由 bot 策略树驱动
 * （良心型/平衡型/投机型 §2.3），与真人共用同一 intent 语义与同一 RNG 事件流（#18 公平）。
 * 全部数值旋钮在 balance.ts。
 */
import { BAL } from './balance'
import type { CustomerType, Intent, MatchResult, SimEvent, SimPhase, SimSnapshot, StallPublic } from './types'

const STEP = 0.1

function lcg(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0
    return a / 0x100000000
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

/** bot 摊名随机池：前缀 × 业态组合，开局随机抽（真人摊的门牌直接印摊主名） */
const BOT_NAME_HEADS = ['老王', '胖子', '张记', '李姐', '大刘', '阿强', '老陈', '三婶', '马哥', '小四川'] as const
const BOT_NAME_TAILS = ['烧烤', '烤串', '串串', '大排档'] as const

/** 同场不重名：与已抽名字去重，20 次兜底后编号 */
function randomBotName(rng: () => number, taken: Set<string>): string {
  for (let i = 0; i < 20; i++) {
    const head = BOT_NAME_HEADS[Math.floor(rng() * BOT_NAME_HEADS.length)]!
    const tail = BOT_NAME_TAILS[Math.floor(rng() * BOT_NAME_TAILS.length)]!
    if (!taken.has(head + tail)) return head + tail
  }
  return `摊位${taken.size + 1}`
}
/** 摊位 → bot 策略（名字即人设：老王良心，胖子投机，张记平衡） */
const STALL_BOTS: Array<'balanced' | 'honest' | 'shady'> = ['balanced', 'honest', 'shady']

interface BotBrain {
  profile: 'honest' | 'balanced' | 'shady'
}

interface StallState {
  id: string
  name: string
  /** 真人座位（认领后不回退：断线座位保留状态等重连；未认领 = bot） */
  human: boolean
  bot: BotBrain | null
  price: number
  reputation: number
  heartburn: number
  money: number
  stockHonest: number
  stockShady: number
  queueLen: number
  servingLeftS: number
  servingShady: boolean
  closedForS: number
  // 经济循环（所有摊位）
  restockTimer: number
  restockDone: boolean
  restockOpenAnnounced: boolean
  decayAcc: number
  starveAcc: number
  stockOutEventCd: number
  /** 回头客池：良心串积累，到点回流（忠于源摊位） */
  loyalDue: number[]
  // 主动博弈动作冷却（W5）
  reportCd: number
  smearCd: number
  // bot 思考节拍
  thinkAcc: number
  // 结算累计
  servedTotal: number
  honestServed: number
  shadyServed: number
  revenue: number
  restockSpent: number
  fines: number
  result: MatchResult | null
}

export class MatchSim {
  private rng: () => number
  private eventId = 0
  private events: SimEvent[] = []
  private acc = 0
  private _version = 0

  timeS = 0
  phase: SimPhase = 'running'
  private stalls: StallState[]
  private nextEventAt = BAL.eventEveryS[0] + BAL.eventEveryS[1] * 0.5
  private surgeLeftS = 0
  private spawnAcc = 0

  constructor(seed: number, seatCount = 3, initialPhase: SimPhase = 'running') {
    this.rng = lcg(seed)
    this.phase = initialPhase
    const takenNames = new Set<string>()
    this.stalls = Array.from({ length: seatCount }, (_, i) => this.makeStall(i, takenNames))
  }

  /** 等待房开局：waiting → running（其余阶段 no-op） */
  start(): void {
    if (this.phase !== 'waiting') return
    this.phase = 'running'
    this._version++
  }

  private makeStall(i: number, takenNames: Set<string>): StallState {
    const profile = STALL_BOTS[i % STALL_BOTS.length]!
    const name = randomBotName(this.rng, takenNames)
    takenNames.add(name)
    return {
      id: `seat-${i}`,
      name,
      human: false,
      bot: { profile },
      price: BAL.bot[profile]!.price,
      reputation: BAL.rivalRep,
      heartburn: 0,
      money: BAL.startMoney,
      stockHonest: 0,
      stockShady: 0,
      queueLen: 0,
      servingLeftS: 0,
      servingShady: false,
      closedForS: 0,
      // 进货车错峰：逐摊错开 3s，避免三家同时到车
      restockTimer: BAL.restockEveryS + i * 3,
      restockDone: false,
      restockOpenAnnounced: false,
      decayAcc: 0,
      starveAcc: 0,
      stockOutEventCd: 0,
      loyalDue: [],
      reportCd: 0,
      smearCd: 0,
      thinkAcc: 0,
      servedTotal: 0,
      honestServed: 0,
      shadyServed: 0,
      revenue: 0,
      restockSpent: 0,
      fines: 0,
      result: null,
    }
  }

  private stall(id: string): StallState | undefined {
    return this.stalls.find((s) => s.id === id)
  }

  private firstHuman(): StallState | undefined {
    return this.stalls.find((s) => s.human)
  }

  get stallIds(): string[] {
    return this.stalls.map((s) => s.id)
  }

  get version(): number {
    return this._version
  }

  /** 真人认领座位：接管 bot 摊位，重置为玩家初始态（新老板不背旧账；口碑是街面的，继承） */
  claim(seatId: string): boolean {
    if (this.phase === 'ended') return false
    const s = this.stall(seatId)
    if (!s || s.human) return false
    s.human = true
    s.bot = null
    s.money = BAL.startMoney
    s.stockHonest = 0
    s.stockShady = 0
    s.heartburn = 0
    s.price = BAL.rivalPrice
    s.restockTimer = BAL.restockWindowS + 2 // 接手后 ~2s 开首个进货窗口：灵魂抉择第一时间摆在面前
    s.restockDone = false
    s.restockOpenAnnounced = false
    this._version++
    return true
  }

  /** 门牌易主：真人认领后摊名直接印摊主名（谁的就是谁的烧烤摊，不再用固定摊名） */
  renameStall(seatId: string, ownerName: string): void {
    const s = this.stall(seatId)
    if (!s || !s.human) return
    const clean = ownerName.trim().slice(0, 16)
    if (!clean || s.name === clean) return
    s.name = clean
    this._version++
  }

  /** 随机挑一个未认领座位：首进不永远坐 0 号摊（随机分配） */
  randomFreeSeat(): string | null {
    const free = this.stalls.filter((s) => !s.human)
    if (free.length === 0) return null
    const pick = free[Math.floor(this.rng() * free.length)]
    return (pick ?? free[0]!).id
  }

  /** 座位 intent：真人唯一的输入通道；bot 不走这里（内部策略树直接调 applyXxx） */
  intent(seatId: string, i: Intent): boolean {
    if (this.phase !== 'running') return false
    const s = this.stall(seatId)
    if (!s || !s.human) return false
    let ok: boolean
    switch (i.kind) {
      case 'price':
        s.price = clamp(Math.round(i.value), BAL.priceMin, BAL.priceMax)
        ok = true
        break
      case 'restock':
        ok = this.tryRestock(s, i.honestShare)
        break
      case 'verify':
        ok = this.tryVerify(s)
        break
      case 'report': {
        const target = this.stall(i.target)
        ok = target ? this.tryReport(s, target) : false
        break
      }
      case 'smear': {
        const target = this.stall(i.target)
        ok = target ? this.trySmear(s, target) : false
        break
      }
    }
    if (ok) this._version++
    return ok
  }

  /** 真实时间驱动；内部固定步长保证确定性。maxDt 限制单次追帧上限（客户端防跳变用） */
  update(dtReal: number, maxDt = 1): void {
    if (this.phase !== 'running') return
    this.acc += Math.min(dtReal, maxDt)
    while (this.acc >= STEP && this.phase === 'running') {
      this.acc -= STEP
      this.step(STEP)
      this._version++
    }
  }

  drainEvents(): SimEvent[] {
    const out = this.events
    this.events = []
    return out
  }

  /**
   * 逐座位个性化快照：顶层 HUD 字段（钱包/库存/定价…）来自 view 座位本人，
   * stalls[] 是整条街的明牌（决策 #7：烧心值全局可见）。观战传 null，看第一个真人摊。
   */
  snapshotFor(viewSeatId: string | null): SimSnapshot {
    const view = (viewSeatId ? this.stall(viewSeatId) : undefined) ?? this.firstHuman() ?? this.stalls[0]!
    return {
      phase: this.phase,
      // waiting 阶段的倒计时由 MatchActor（知道 autoStartS 策略）回填，模拟核心不管
      waitingLeftS: null,
      timeS: Math.floor(this.timeS),
      durationS: BAL.durationS,
      money: Math.round(view.money * 100) / 100,
      stockHonest: Math.max(0, view.stockHonest),
      stockShady: Math.max(0, view.stockShady),
      price: view.price,
      reputation: Math.round(view.reputation * 10) / 10,
      heartburn: Math.round(view.heartburn * 10) / 10,
      servedTotal: view.servedTotal,
      restockInS: Math.ceil(Math.max(0, view.restockTimer - BAL.restockWindowS)),
      restockWindowLeftS: view.restockTimer <= BAL.restockWindowS ? Math.ceil(view.restockTimer) : null,
      restockDone: view.restockDone,
      reportCdLeftS: Math.ceil(Math.max(0, view.reportCd)),
      smearCdLeftS: Math.ceil(Math.max(0, view.smearCd)),
      stalls: this.stalls.map(
        (s): StallPublic => ({
          id: s.id,
          name: s.name,
          isPlayer: viewSeatId !== null && s.id === viewSeatId,
          human: s.human,
          price: s.price,
          queueLen: s.queueLen,
          reputation: Math.round(s.reputation * 10) / 10,
          heartburn: Math.round(s.heartburn * 10) / 10,
          closedForS: Math.ceil(s.closedForS),
        }),
      ),
      result: view.result,
      version: this._version,
    }
  }

  // ---------- 内部：模拟循环 ----------

  private push(seat: string | null, kind: SimEvent['kind'], vars?: Record<string, string | number>): void {
    this.events.push({ id: ++this.eventId, kind, ...(seat ? { seat } : {}), ...(vars ? { vars } : {}) })
  }

  private step(dt: number): void {
    this.timeS += dt
    if (this.timeS >= BAL.durationS) {
      this.end()
      return
    }

    // 顾客生成（缓升打底 + 人潮 surges，决策 #18；人潮全街共享）
    let rate = BAL.baseSpawnPerS + BAL.spawnGrowthPerS * this.timeS
    if (this.surgeLeftS > 0) {
      this.surgeLeftS -= dt
      rate *= BAL.surgeMult
    }
    this.spawnAcc += rate * dt
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1
      this.spawnCustomer()
    }

    // 回头客回流（各摊独立记忆）
    for (const s of this.stalls) {
      while (s.loyalDue.length > 0 && this.timeS >= (s.loyalDue[0] ?? Infinity)) {
        s.loyalDue.shift()
        this.spawnCustomer('loyal', s.id)
        this.push(s.id, 'loyal_return')
      }
    }

    // 随机事件流（全局触发；同局共享 RNG 事件流，公平性 #18）
    if (this.timeS >= this.nextEventAt) {
      this.fireEvent()
      this.nextEventAt = this.timeS + BAL.eventEveryS[0] + this.rng() * (BAL.eventEveryS[1] - BAL.eventEveryS[0])
    }

    for (const s of this.stalls) {
      if (s.bot) this.botThink(s, dt)
      this.stepStall(s, dt)
    }
  }

  private stepStall(s: StallState, dt: number): void {
    // 动作冷却
    if (s.reportCd > 0) s.reportCd = Math.max(0, s.reportCd - dt)
    if (s.smearCd > 0) s.smearCd = Math.max(0, s.smearCd - dt)

    // 进货车周期（停业整顿期间照常到车）
    s.restockTimer -= dt
    if (!s.restockOpenAnnounced && s.restockTimer <= BAL.restockWindowS && s.restockTimer > 0) {
      s.restockOpenAnnounced = true
      this.push(s.id, 'restock_open')
    }
    if (s.restockTimer <= 0) {
      if (!s.restockDone) this.push(s.id, 'restock_skipped')
      s.restockTimer = BAL.restockEveryS
      s.restockDone = false
      s.restockOpenAnnounced = false
    }

    // 烧心值自然消退（每 10s）
    s.decayAcc += dt
    if (s.decayAcc >= 10) {
      s.decayAcc -= 10
      s.heartburn = Math.max(0, s.heartburn - BAL.heartburnDecayPer10S)
    }

    // 烧心超标：口碑持续流失 + 抽检风险（概率按真实秒率走，别写成每步抽奖）
    if (s.heartburn >= BAL.heartburnRiskAt) {
      s.reputation = Math.max(0, s.reputation - BAL.repDrainPerSAtRisk * dt)
      if (this.rng() < BAL.riskFineChancePerS * dt) this.inspectStall(s)
    }
    if (s.stockOutEventCd > 0) s.stockOutEventCd -= dt

    if (s.closedForS > 0) {
      s.closedForS -= dt
      if (s.closedForS <= 0) s.closedForS = 0
      if (s.queueLen > 0) s.queueLen = Math.max(0, s.queueLen - Math.ceil(dt * 2)) // 停业散客
      return
    }

    if (s.servingLeftS > 0) {
      s.servingLeftS -= dt
      if (s.servingLeftS <= 0) {
        s.servingLeftS = 0
        s.queueLen = Math.max(0, s.queueLen - 1)
        this.onServe(s, s.servingShady)
      }
      return
    }

    // 空闲：接单。出餐构成按库存占比抽（W7 调参：原 LIFO「狠活先卖」会让库存滚雪球、
    // 「半掺」实际吃成全狠活——进货滑条的承诺和实际出餐必须一致）
    const hasStock = s.stockShady + s.stockHonest > 0
    if (s.queueLen > 0 && hasStock) {
      const shady = this.rng() < s.stockShady / (s.stockShady + s.stockHonest)
      if (shady) s.stockShady--
      else s.stockHonest = Math.max(0, s.stockHonest - 1)
      s.servingShady = shady
      s.servingLeftS = shady ? BAL.serviceSShady : BAL.serviceSHonest
      return
    }

    // 断货守候流失
    if (s.queueLen > 0 && !hasStock) {
      s.starveAcc += dt
      if (s.starveAcc >= 3) {
        s.starveAcc = 0
        s.queueLen--
        s.reputation = Math.max(0, s.reputation - 0.5)
        if (s.stockOutEventCd <= 0) {
          s.stockOutEventCd = 10
          this.push(s.id, 'stock_out')
        }
      }
    }
  }

  private onServe(s: StallState, shady: boolean): void {
    s.servedTotal++
    s.money += s.price
    s.revenue += s.price
    if (shady) {
      s.shadyServed++
      s.heartburn = Math.min(100, s.heartburn + BAL.heartburnPerShady)
      s.reputation = Math.max(0, s.reputation - BAL.repPerShadySold)
      const dalvy = this.rng() < 0.25
      const chance = dalvy ? BAL.badReviewChanceDalvy : BAL.badReviewChanceShady
      if (this.rng() < chance) {
        s.reputation = Math.max(0, s.reputation + BAL.repPerBadReview)
        this.push(s.id, 'bad_review', { reason: dalvy ? 'dalvy' : 'shady' })
      }
    } else {
      s.honestServed++
      s.heartburn = Math.max(0, s.heartburn - BAL.heartburnReliefPerHonest)
      s.reputation = Math.min(100, s.reputation + BAL.repPerHonestSold)
      if (this.rng() < BAL.loyalChanceAfterHonest) {
        const delay = BAL.loyalReturnDelayS[0] + this.rng() * (BAL.loyalReturnDelayS[1] - BAL.loyalReturnDelayS[0])
        s.loyalDue.push(this.timeS + delay)
        s.loyalDue.sort((a, b) => a - b)
      }
    }
  }

  private spawnCustomer(mode: 'normal' | 'loyal' = 'normal', homeId: string | null = null): void {
    const r = this.rng()
    let type: CustomerType = 'tourist'
    let acc = 0
    for (const [t, share] of Object.entries(BAL.typeShare)) {
      acc += share
      if (r < acc) {
        type = t as CustomerType
        break
      }
    }
    this.chooseStall(type, mode === 'loyal' ? BAL.loyalQualityBonus : 0, homeId)
  }

  private chooseStall(type: CustomerType, loyalBonus: number, homeId: string | null): void {
    const w =
      type === 'tourist'
        ? {
            price: this.rng(),
            quality: this.rng(),
            queue: this.rng(),
            risk: this.rng(),
          }
        : (BAL.weights[type] ?? BAL.weights.tourist)
    const wSum = w.price + w.quality + w.queue + w.risk || 1

    let best: StallState | null = null
    let bestU = -Infinity
    const ranked: Array<{ s: StallState; u: number }> = []
    for (const s of this.stalls) {
      if (s.closedForS > 0) continue
      const effQueue = s.queueLen + (s.servingLeftS > 0 ? 1 : 0)
      const priceScore = clamp((BAL.priceMax - s.price) / (BAL.priceMax - BAL.priceMin), 0, 1)
      // 回头客只忠于源摊位（忠诚度记忆 #17）
      const qualityScore = clamp(s.reputation / 100 + (homeId !== null && s.id === homeId ? loyalBonus : 0), 0, 1)
      const queueScore = clamp(1 - effQueue / BAL.queueCap, 0, 1)
      const riskScore = clamp(1 - s.heartburn / 100, 0, 1)
      const u =
        ((w.price * priceScore + w.quality * qualityScore + w.queue * queueScore + w.risk * riskScore) / wSum) +
        (this.rng() - 0.5) * 2 * BAL.utilityNoise
      ranked.push({ s, u })
      if (u > bestU) {
        bestU = u
        best = s
      }
    }

    ranked.sort((a, b) => b.u - a.u)
    for (const { s, u } of ranked) {
      if (s.queueLen < BAL.queueCap && (u >= BAL.utilityLeaveThreshold || s === best)) {
        s.queueLen++
        return
      }
    }
    // 都满/分太低：逛逛就走
  }

  private fireEvent(): void {
    const r = this.rng()
    if (r < 0.4) {
      this.surgeLeftS = BAL.surgeDurS
      this.push(null, 'surge', { durS: BAL.surgeDurS }) // 全局事件：三家同享人潮
      return
    }
    if (r < 0.75) {
      // 检查风波：逐摊同判（烧心值超标各罚各的）
      for (const s of this.stalls) this.inspectStall(s)
      return
    }
    // 顾客验货：随机点一家正在出餐的摊看柜台正烤的那串
    const serving = this.stalls.filter((s) => s.servingLeftS > 0 || s.queueLen > 0)
    const target = serving.length > 0 ? serving[Math.floor(this.rng() * serving.length)] ?? serving[0]! : undefined
    if (!target) return
    if (target.servingLeftS > 0 && target.servingShady) {
      target.reputation = Math.max(0, target.reputation + BAL.repPerBadReview)
      this.push(target.id, 'bad_review', { reason: 'verify' })
    } else {
      target.reputation = Math.min(100, target.reputation + BAL.repPerVerifiedHonest)
      this.push(target.id, 'inspection_pass')
    }
  }

  /** 市场监管抽检：烧心值超标必罚（举报也走这里）。返回过检结果供举报反馈 */
  private inspectStall(s: StallState): 'fine' | 'pass' {
    // 掷骰式判罚（W8 用户裁定）：抽检力度 = 烧心值 × 现场随机系数(0.25~1.25)，力度 ≥ 25 查实。
    // 烧心再低也留 5% 底池（现场抓包），烧心 100 必罚——举报键永远有意义，不死板
    const roll = BAL.inspectRollMin + this.rng() * (BAL.inspectRollMax - BAL.inspectRollMin)
    if (s.heartburn * roll >= BAL.inspectRollK || this.rng() < BAL.reportBaseChance) {
      const fine = Math.min(BAL.fineAmount, Math.round(s.money * 100) / 100)
      s.money = Math.round((s.money - fine) * 100) / 100
      s.fines += fine
      s.closedForS = BAL.closeS
      this.push(s.id, 'inspection_fine', { fine, closeS: BAL.closeS })
      return 'fine'
    }
    s.reputation = Math.min(100, s.reputation + BAL.repPerInspectionPass)
    this.push(s.id, 'inspection_pass')
    return 'pass'
  }

  private end(): void {
    this.phase = 'ended'
    this.timeS = BAL.durationS
    for (const s of this.stalls) {
      const revenue = Math.round(s.revenue)
      const profit = Math.round(s.revenue - s.restockSpent - s.fines)
      const score = Math.max(0, Math.round(s.revenue + s.reputation * BAL.scoreRepWeight))
      const gradeKey =
        score < 600
          ? 'game.grade.apprentice'
          : score < 1000
            ? 'game.grade.veteran'
            : score < 1500
              ? 'game.grade.rising'
              : 'game.grade.master'
      s.result = {
        revenue,
        profit,
        reputation: Math.round(s.reputation),
        served: s.servedTotal,
        honestServed: s.honestServed,
        shadyServed: s.shadyServed,
        fines: Math.round(s.fines),
        score,
        gradeKey,
      }
    }
    this.push(null, 'ended')
  }

  // ---------- 内部：主动动作（真人 intent 与 bot 策略树共用） ----------

  private tryRestock(s: StallState, honestShare: number): boolean {
    if (s.restockTimer > BAL.restockWindowS || s.restockDone) return false // 不在窗口
    const share = clamp(honestShare, 0, 1)
    const unitCost = BAL.costShady + (BAL.costHonest - BAL.costShady) * share
    const qty = Math.min(BAL.restockMax, Math.floor(s.money / unitCost))
    if (qty <= 0) return false
    const cost = Math.round(qty * unitCost * 100) / 100
    s.money = Math.round((s.money - cost) * 100) / 100
    s.restockSpent += cost
    const honest = Math.round(qty * share)
    s.stockHonest += honest
    s.stockShady += qty - honest
    s.restockDone = true
    s.restockTimer = BAL.restockEveryS
    s.restockOpenAnnounced = false
    this.push(s.id, 'restock_done', { qty, cost, honest: qty - honest === 0 ? '全良心' : share === 0 ? '全狠活' : '混合' })
    return true
  }

  private tryVerify(s: StallState): boolean {
    if (s.heartburn < BAL.verifyMinHeartburn) return false
    if (s.money < BAL.verifyCost) return false
    s.money = Math.round((s.money - BAL.verifyCost) * 100) / 100
    s.heartburn = Math.max(0, s.heartburn - BAL.verifyRelief)
    this.push(s.id, 'self_verified', { cost: BAL.verifyCost })
    return true
  }

  private tryReport(s: StallState, target: StallState): boolean {
    if (target === s) return false
    if (s.reportCd > 0) return false
    s.reportCd = BAL.reportCooldownS
    const outcome = this.inspectStall(target)
    if (outcome === 'fine') {
      this.push(s.id, 'report_hit', { target: target.name })
      return true
    }
    // 举报落空：目标干干净净过检，举报者口碑受损（别乱报）。带上对方烧心值：让"盯数值"有的放矢
    s.reputation = Math.max(0, s.reputation - BAL.reportCleanRepCost)
    this.push(s.id, 'report_clean', { target: target.name, heartburn: Math.round(target.heartburn) })
    return true
  }

  private trySmear(s: StallState, target: StallState): boolean {
    if (target === s) return false
    if (s.smearCd > 0) return false
    if (s.money < BAL.smearCost) return false
    s.money = Math.round((s.money - BAL.smearCost) * 100) / 100
    s.smearCd = BAL.reportCooldownS
    if (this.rng() < BAL.smearCaughtChance) {
      s.reputation = Math.max(0, s.reputation - BAL.smearCaughtRep)
      this.push(s.id, 'smear_caught')
      return true
    }
    target.reputation = Math.max(0, target.reputation - BAL.smearRepHit)
    this.push(target.id, 'bad_review', { reason: 'smear' })
    this.push(s.id, 'smear_done', { target: target.name })
    return true
  }

  // ---------- 内部：bot 策略树（§2.3，全部走 RNG 保确定性） ----------

  private botThink(s: StallState, dt: number): void {
    if (!s.bot) return
    s.thinkAcc += dt
    if (s.thinkAcc < BAL.botThinkEveryS) return
    s.thinkAcc = 0
    const p = BAL.bot[s.bot.profile]!
    const noise = BAL.botNoise

    // 定价：围绕策略基准价抖动（每拍微调）
    const targetPrice = clamp(p.price + (this.rng() - 0.5) * 2 * noise * 4, BAL.priceMin, BAL.priceMax)
    s.price = Math.round(targetPrice * 2) / 2

    // 进货：窗口内按策略良心占比补货
    if (s.restockTimer <= BAL.restockWindowS && !s.restockDone) {
      const share = clamp(p.honestShare + (this.rng() - 0.5) * 2 * noise, 0, 1)
      this.tryRestock(s, share)
    }

    // 自证清白：烧心值逼近红线且有余钱
    if (s.heartburn >= p.selfVerifyAt && s.money >= BAL.verifyCost && this.rng() < 0.5) {
      this.tryVerify(s)
    }

    // 举报：盯全街明牌，等别人烧心值够高再下手
    if (s.reportCd <= 0 && this.rng() < p.reportChance) {
      const target = this.stalls
        .filter((o) => o !== s && o.heartburn >= p.reportAt)
        .sort((a, b) => b.heartburn - a.heartburn)[0]
      if (target) this.tryReport(s, target)
    }

    // 刷差评：眼红口碑领跑者
    if (s.smearCd <= 0 && s.money >= BAL.smearCost && this.rng() < p.smearChance) {
      const target = this.stalls
        .filter((o) => o !== s && o.reputation > s.reputation + p.smearLeadBy)
        .sort((a, b) => b.reputation - a.reputation)[0]
      if (target) this.trySmear(s, target)
    }
  }
}
