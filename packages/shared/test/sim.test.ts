import { describe, expect, it } from 'vitest'
import { BAL } from '../src/sim/balance'
import { MatchSim } from '../src/sim/sim'

const STEP = 0.1
const ticks = (seconds: number) => Math.round(seconds / STEP)

/** 开一局并认领 seat-0 为真人摊 */
function makeSim(seed: number, seatCount = 3): MatchSim {
  const sim = new MatchSim(seed, seatCount)
  sim.claim('seat-0')
  return sim
}

/** 推进到下一个进货决策窗口（认领后 ~2s 即开首个窗口） */
function advanceToWindow(sim: MatchSim, maxS = 70): boolean {
  for (let i = 0; i < ticks(maxS); i++) {
    sim.update(STEP)
    if (sim.snapshotFor('seat-0').restockWindowLeftS !== null) return true
  }
  return false
}

/** 自动游玩脚本：每个进货窗口用指定良心占比补货，价格固定 */
function runWithStrategy(sim: MatchSim, seconds: number, honestShare: number, price: number): void {
  for (let i = 0; i < ticks(seconds); i++) {
    sim.intent('seat-0', { kind: 'price', value: price })
    const snap = sim.snapshotFor('seat-0')
    if (snap.phase === 'ended') return
    if (snap.restockWindowLeftS !== null) sim.intent('seat-0', { kind: 'restock', honestShare })
    sim.update(STEP)
  }
}

describe('MatchSim 模拟核心', () => {
  it('同 seed 同操作 ⇒ 逐字节一致的确定性结果（决策 #9 前置）', () => {
    const a = makeSim(42)
    const b = makeSim(42)
    runWithStrategy(a, 120, 0.5, 7)
    runWithStrategy(b, 120, 0.5, 7)
    const ea = a.drainEvents()
    const eb = b.drainEvents()
    expect(ea).toEqual(eb)
    const sa = { ...a.snapshotFor('seat-0'), version: 0 }
    const sb = { ...b.snapshotFor('seat-0'), version: 0 }
    expect(JSON.stringify(sa)).toBe(JSON.stringify(sb))
  })

  it('良心全款进货：数量由余额决定，成本 = 串数 × 3', () => {
    const sim = makeSim(1)
    expect(advanceToWindow(sim)).toBe(true)
    const before = sim.snapshotFor('seat-0').money
    sim.intent('seat-0', { kind: 'restock', honestShare: 1 })
    const snap = sim.snapshotFor('seat-0')
    expect(snap.stockHonest).toBe(33) // floor(¥100 / ¥3)
    expect(snap.stockShady).toBe(0)
    expect(before - snap.money).toBeCloseTo(99, 5)
    expect(snap.restockDone).toBe(true) // 本班已下单：UI 弹窗据此关闭
    expect(sim.intent('seat-0', { kind: 'restock', honestShare: 0 })).toBe(false) // 每班车限一次
    // 重复下单不改库存不改钱包
    expect(sim.snapshotFor('seat-0').stockHonest).toBe(33)
  })

  it('全狠活 + 低价走量 ⇒ 烧心值攀升、口碑受蚀', () => {
    const sim = makeSim(2)
    expect(advanceToWindow(sim)).toBe(true)
    sim.intent('seat-0', { kind: 'restock', honestShare: 0 })
    for (let i = 0; i < ticks(80); i++) {
      sim.intent('seat-0', { kind: 'price', value: 4 })
      sim.update(STEP)
    }
    const snap = sim.snapshotFor('seat-0')
    expect(snap.servedTotal).toBeGreaterThan(10)
    expect(snap.heartburn).toBeGreaterThan(30)
  })

  it('烧心值超标后监管抽检必罚（决策 #7 的风险闭环）', () => {
    const sim = makeSim(3)
    expect(advanceToWindow(sim)).toBe(true)
    sim.intent('seat-0', { kind: 'restock', honestShare: 0 })
    for (let i = 0; i < ticks(220); i++) {
      sim.intent('seat-0', { kind: 'price', value: 4 })
      sim.update(STEP)
    }
    const kinds = sim.drainEvents().map((e) => e.kind)
    expect(kinds).toContain('inspection_fine')
  })

  it('整局跑完：结算字段齐全、分项对得上（W3 红线：单机完整一局）', () => {
    const sim = makeSim(7)
    runWithStrategy(sim, 520, 0.5, 7) // 比一局长，跑到自然结束
    expect(sim.snapshotFor('seat-0').phase).toBe('ended')
    const r = sim.snapshotFor('seat-0').result
    expect(r).not.toBeNull()
    expect(r!.served).toBeGreaterThan(30)
    expect(r!.honestServed + r!.shadyServed).toBe(r!.served)
    expect(Number.isFinite(r!.revenue)).toBe(true)
    expect(Number.isFinite(r!.profit)).toBe(true)
    expect(r!.score).toBeGreaterThanOrEqual(0)
    expect(r!.gradeKey).toMatch(/^game\.grade\./)
  })

  it('良心路线回流回头客（#17 忠诚度记忆）', () => {
    const sim = makeSim(11)
    expect(advanceToWindow(sim)).toBe(true)
    sim.intent('seat-0', { kind: 'restock', honestShare: 1 })
    const servedBefore = sim.snapshotFor('seat-0').servedTotal
    for (let i = 0; i < ticks(120); i++) {
      sim.intent('seat-0', { kind: 'price', value: 6 })
      sim.update(STEP)
    }
    expect(sim.snapshotFor('seat-0').servedTotal).toBeGreaterThan(servedBefore)
    // 120s 内良心串持续卖出，事件流里应出现回头客回流
    const kinds = sim.drainEvents().map((e) => e.kind)
    expect(kinds).toContain('loyal_return')
  })
})

describe('MatchSim 多座位与 bot（W4 服务器权威 / W5 对战）', () => {
  it('多座位独立经济：各摊钱包/库存互不串，明牌互相可见', () => {
    const sim = new MatchSim(5)
    sim.claim('seat-0')
    sim.claim('seat-1')
    expect(advanceToWindow(sim)).toBe(true)
    sim.intent('seat-0', { kind: 'restock', honestShare: 1 })
    sim.intent('seat-1', { kind: 'restock', honestShare: 0 })

    const s0 = sim.snapshotFor('seat-0')
    const s1 = sim.snapshotFor('seat-1')
    expect(s0.money).toBeCloseTo(1, 5) // 100 − 33 × ¥3
    expect(s1.money).toBeCloseTo(0, 5) // 100 − 100 × ¥1
    expect(s0.stockHonest).toBe(33)
    expect(s1.stockShady).toBe(100)
    expect(s0.stalls.find((s) => s.id === 'seat-0')!.isPlayer).toBe(true)
    expect(s0.stalls.find((s) => s.id === 'seat-1')!.isPlayer).toBe(false)
    expect(s1.stalls.find((s) => s.id === 'seat-1')!.isPlayer).toBe(true)
  })

  it('认领座位重置为玩家初始态：烧心值清零，不背 bot 的账', () => {
    const sim = new MatchSim(9)
    for (let i = 0; i < ticks(10); i++) sim.update(STEP) // bot 摊先跑 1s
    expect(sim.claim('seat-0')).toBe(true)
    const snap = sim.snapshotFor('seat-0')
    expect(snap.heartburn).toBe(0)
    expect(snap.money).toBe(BAL.startMoney)
    expect(sim.claim('seat-0')).toBe(false) // 幂等：重复认领无效
  })

  it('bot 策略树：投机型烧心值显著高于良心型，且都有真实经济（W5）', () => {
    const sim = new MatchSim(26) // 无真人：三个 bot（张记平衡/老王良心/胖子投机）
    for (let i = 0; i < ticks(300); i++) sim.update(STEP)
    const snap = sim.snapshotFor(null)
    const laowang = snap.stalls.find((s) => s.id === 'seat-1')!
    const pangzi = snap.stalls.find((s) => s.id === 'seat-2')!
    expect(laowang.heartburn).toBeLessThan(pangzi.heartburn)
    // bot 会进货卖串赚钱
    expect(sim.snapshotFor('seat-1').servedTotal).toBeGreaterThan(0)
    expect(sim.snapshotFor('seat-2').servedTotal).toBeGreaterThan(0)
  })

  it('快照个性化：观战视角看第一个真人摊且无人被标 isPlayer', () => {
    const sim = makeSim(8)
    for (let i = 0; i < ticks(5); i++) sim.update(STEP)
    const spec = sim.snapshotFor(null)
    expect(spec.stalls.every((s) => !s.isPlayer)).toBe(true)
    expect(spec.money).toBe(BAL.startMoney) // 第一个真人摊 = seat-0
  })
})

describe('MatchSim 主动博弈（W5：举报/自证/刷差评）', () => {
  it('举报命中：掷骰式判罚——烧心 100 力度必过阈值，确定性 report_hit', () => {
    const sim = makeSim(21)
    // W7 调参后 bot 会自证管理烧心值、不再自然爆表——把胖子摊认领为「摆烂狠活」真人摊，
    // 把烧心值推到顶格 100：力度 = 烧心 × roll(0.25~1.25) ≥ 25 恒成立，测试走确定性路径
    sim.claim('seat-2')
    let hot = false
    for (let i = 0; i < ticks(3000) && !hot; i++) {
      const pangzi = sim.snapshotFor('seat-2')
      sim.intent('seat-2', { kind: 'price', value: 4 })
      if (pangzi.restockWindowLeftS !== null && !pangzi.restockDone) {
        sim.intent('seat-2', { kind: 'restock', honestShare: 0 })
      }
      sim.intent('seat-0', { kind: 'price', value: 6 })
      sim.update(STEP)
      hot = (sim.snapshotFor('seat-0').stalls.find((s) => s.id === 'seat-2')?.heartburn ?? 0) >= 100
    }
    expect(hot).toBe(true) // 摆烂狠活必然顶格（中途随机自查不重置烧心值，只会慢一点）
    expect(sim.intent('seat-0', { kind: 'report', target: 'seat-2' })).toBe(true)
    const kinds = sim.drainEvents().filter((e) => e.seat === 'seat-0').map((e) => e.kind)
    expect(kinds).toContain('report_hit')
    expect(sim.snapshotFor('seat-0').stalls.find((s) => s.id === 'seat-2')!.closedForS).toBeGreaterThan(0)
  })

  it('举报落空：目标干净过检，举报者口碑受损（别乱报）', () => {
    const sim = makeSim(26) // 种子是确定性的一部分：5% 底池下该种子此回合必然落空（换种子可能命中）
    for (let i = 0; i < ticks(20); i++) {
      sim.intent('seat-0', { kind: 'price', value: 6 })
      sim.update(STEP)
    }
    // t=20s 时老王（良心型）还没开过进货窗口（首窗 ~51s），必然干净
    const before = sim.snapshotFor('seat-0')
    expect(sim.intent('seat-0', { kind: 'report', target: 'seat-1' })).toBe(true)
    const kinds = sim.drainEvents().filter((e) => e.seat === 'seat-0').map((e) => e.kind)
    expect(kinds).toContain('report_clean')
    expect(sim.snapshotFor('seat-0').reputation).toBeCloseTo(before.reputation - BAL.reportCleanRepCost, 5)
  })

  it('自证清白：花钱压烧心值；嫌疑不足时拒绝', () => {
    const sim = makeSim(23)
    expect(advanceToWindow(sim)).toBe(true)
    sim.intent('seat-0', { kind: 'restock', honestShare: 0 }) // 全狠活
    for (let i = 0; i < ticks(600) && sim.snapshotFor('seat-0').heartburn < BAL.verifyMinHeartburn; i++) {
      sim.intent('seat-0', { kind: 'price', value: 4 })
      sim.update(STEP)
    }
    const before = sim.snapshotFor('seat-0')
    expect(before.heartburn).toBeGreaterThanOrEqual(BAL.verifyMinHeartburn)
    expect(sim.intent('seat-0', { kind: 'verify' })).toBe(true)
    const after = sim.snapshotFor('seat-0')
    expect(after.heartburn).toBeLessThan(before.heartburn)
    expect(before.money - after.money).toBeCloseTo(BAL.verifyCost, 5)

    const clean = makeSim(24)
    expect(clean.intent('seat-0', { kind: 'verify' })).toBe(false) // 烧心值 0，无嫌疑
  })

  it('刷差评：花钱、目标受损或被抓（种子确定分支）、冷却生效', () => {
    const sim = makeSim(25)
    for (let i = 0; i < ticks(30); i++) {
      sim.intent('seat-0', { kind: 'price', value: 6 })
      sim.update(STEP)
    }
    const before = sim.snapshotFor('seat-0')
    expect(sim.intent('seat-0', { kind: 'smear', target: 'seat-2' })).toBe(true)
    const after = sim.snapshotFor('seat-0')
    const kinds = sim.drainEvents().filter((e) => e.seat === 'seat-0').map((e) => e.kind)
    expect(kinds.some((k) => k === 'smear_done' || k === 'smear_caught')).toBe(true)
    expect(before.money - after.money).toBeCloseTo(BAL.smearCost, 5)
    expect(after.smearCdLeftS).toBeGreaterThan(0)
    expect(sim.intent('seat-0', { kind: 'smear', target: 'seat-2' })).toBe(false) // 冷却中
  })

  it('整局三方结算：bot 也计分（W5 完整对战红线）', () => {
    const sim = makeSim(27)
    runWithStrategy(sim, 520, 0.5, 7)
    expect(sim.snapshotFor('seat-0').phase).toBe('ended')
    for (const id of ['seat-0', 'seat-1', 'seat-2']) {
      const r = sim.snapshotFor(id).result
      expect(r).not.toBeNull()
      expect(r!.served).toBeGreaterThan(0)
      expect(r!.honestServed + r!.shadyServed).toBe(r!.served)
      expect(r!.revenue).toBeGreaterThan(0)
    }
  })
})
