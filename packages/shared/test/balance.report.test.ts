import { expect, it } from 'vitest'
import { BAL } from '../src/sim/balance'
import { MatchSim } from '../src/sim/sim'
import type { MatchResult } from '../src/sim/types'

/**
 * W7 数值平衡 harness：headless 跑批 + 分布报告 + 退化守护（红线「良心 vs 狠活都有活路」）。
 * - 全 bot 对局：三策略同场（张记=平衡 / 老王=良心 / 胖子=狠活），看策略层强度
 * - 真人脚本对局：三种可执行的真人打法（全良心/半掺/全狠活）接手套，看玩家层强度
 * - 同 seed 配对：各场景共享同一 RNG 事件流，差异即策略差异
 * 调参入口 packages/shared/src/sim/balance.ts；跑大批：BALANCE_SEEDS=1000 pnpm balance
 */

const STEP = 0.1
const SEEDS = Number(process.env.BALANCE_SEEDS ?? 100)
const HUMAN_SEEDS = Number(process.env.BALANCE_HUMAN_SEEDS ?? 50)

/** 摊位下标 → bot 策略（与 sim.ts STALL_BOTS 对齐：张记平衡 / 老王良心 / 胖子狠活） */
const SEAT_PROFILE = ['balanced', 'honest', 'shady'] as const

interface Agg {
  n: number
  score: number
  revenue: number
  rep: number
  served: number
  /** 良心串占比（每局一值，此处累计） */
  honestShare: number
  fines: number
  fineCount: number
  peakHeartburn: number
}

function emptyAgg(): Agg {
  return { n: 0, score: 0, revenue: 0, rep: 0, served: 0, honestShare: 0, fines: 0, fineCount: 0, peakHeartburn: 0 }
}

function absorb(a: Agg, r: MatchResult): void {
  a.n++
  a.score += r.score
  a.revenue += r.revenue
  a.rep += r.reputation
  a.served += r.served
  a.honestShare += r.served > 0 ? r.honestServed / r.served : 0
  a.fines += r.fines
}

/** 跨对局聚合：把单局（或已聚合）的 Agg 并入总量 */
function mergeAgg(a: Agg, b: Agg): void {
  a.n += b.n
  a.score += b.score
  a.revenue += b.revenue
  a.rep += b.rep
  a.served += b.served
  a.honestShare += b.honestShare
  a.fines += b.fines
  a.fineCount += b.fineCount
  a.peakHeartburn += b.peakHeartburn
}

function mean(a: Agg, k: keyof Omit<Agg, 'n'>): number {
  return Math.round((a[k] / Math.max(1, a.n)) * 10) / 10
}

/** 跑一局；human 给定则认领 seat-0 按脚本打（每窗口必进货、价格恒定、烧心超阈值自证）。真人摊聚合另存 'human' */
function runMatch(seed: number, human?: { honestShare: number; price: number; verifyAt?: number }): Map<string, Agg> {
  const sim = new MatchSim(seed, 3)
  if (human) sim.claim('seat-0')
  const stats = new Map<string, Agg>()
  for (const id of sim.stallIds) stats.set(id, emptyAgg())
  const peak = new Map<string, number>(sim.stallIds.map((id) => [id, 0]))
  const fineCount = new Map<string, number>()
  let step = 0

  while (sim.phase === 'running') {
    if (human) {
      sim.intent('seat-0', { kind: 'price', value: human.price })
      const snap = sim.snapshotFor('seat-0')
      if (human.verifyAt !== undefined && snap.heartburn >= human.verifyAt && snap.money >= BAL.verifyCost) {
        sim.intent('seat-0', { kind: 'verify' })
      }
      if (snap.restockWindowLeftS !== null && !snap.restockDone) {
        sim.intent('seat-0', { kind: 'restock', honestShare: human.honestShare })
      }
    }
    sim.update(STEP)
    step++
    for (const e of sim.drainEvents()) {
      if (e.seat && e.kind === 'inspection_fine') fineCount.set(e.seat, (fineCount.get(e.seat) ?? 0) + 1)
    }
    // 每秒（10 步）采样烧心峰值
    if (step % 10 === 0) {
      for (const id of sim.stallIds) {
        peak.set(id, Math.max(peak.get(id)!, sim.snapshotFor(id).heartburn))
      }
    }
  }

  for (const [i, id] of sim.stallIds.entries()) {
    const r = sim.snapshotFor(id).result
    expect(r, `seed=${seed} ${id} 应有结算`).not.toBeNull()
    expect(Number.isFinite(r!.score), `seed=${seed} ${id} 分数应有限`).toBe(true)
    const a = stats.get(id)!
    absorb(a, r!)
    a.fineCount = fineCount.get(id) ?? 0
    a.peakHeartburn = peak.get(id)!
    if (human && i === 0) stats.set('human', a)
  }
  return stats
}

function row(label: string, a: Agg) {
  return {
    场景: label,
    局数: a.n,
    均分: mean(a, 'score'),
    均营收: mean(a, 'revenue'),
    均口碑: mean(a, 'rep'),
    均出餐: mean(a, 'served'),
    良心占比: Math.round(mean(a, 'honestShare') * 100) + '%',
    均罚款: mean(a, 'fines'),
    罚款率: Math.round(mean(a, 'fineCount') * 100) / 100,
    峰值烧心: mean(a, 'peakHeartburn'),
  }
}

it('平衡报告：全 bot 三策略同场（每 seed 三摊共享事件流）', () => {
  const aggs = new Map<string, Agg>(SEAT_PROFILE.map((p) => [p, emptyAgg()]))
  for (let seed = 1; seed <= SEEDS; seed++) {
    const stats = runMatch(seed)
    for (const [i, id] of ['seat-0', 'seat-1', 'seat-2'].entries()) {
      mergeAgg(aggs.get(SEAT_PROFILE[i]!)!, stats.get(id)!)
    }
  }
  console.table([...aggs.entries()].map(([p, a]) => row(`bot·${p}`, a)))

  // 退化守护：任何策略都不该被饿死（没人气=玩不了）
  for (const [p, a] of aggs) {
    expect(a.served / a.n, `bot·${p} 平均出餐`).toBeGreaterThan(30)
  }
})

it('平衡报告：真人脚本四打法（全良心/半掺/狠活会自证/狠活摆烂）', () => {
  const scenarios = [
    { label: 'human·全良心', honestShare: 0.9, price: 8 },
    { label: 'human·半掺', honestShare: 0.5, price: 6.5, verifyAt: 60 },
    { label: 'human·狠活会自证', honestShare: 0.1, price: 5, verifyAt: 60 },
    { label: 'human·狠活摆烂', honestShare: 0.1, price: 5 },
  ]
  const aggs = new Map<string, Agg>(scenarios.map((s) => [s.label, emptyAgg()]))
  for (let seed = 1; seed <= HUMAN_SEEDS; seed++) {
    for (const s of scenarios) {
      mergeAgg(aggs.get(s.label)!, runMatch(seed, s).get('human')!)
    }
  }
  console.table([...aggs.entries()].map(([label, a]) => row(label, a)))
  // 红线：可执行的三种正经打法应同在一个量级（取舍要有纠结感，不许躺赢）。
  // 「摆烂狠活」是惩罚路径，故意排除——烧心超标不处理就该挨罚，这正是机制该有的样子。
  const band = ['human·全良心', 'human·半掺', 'human·狠活会自证'].map((l) => aggs.get(l)!.score / Math.max(1, aggs.get(l)!.n))
  expect(Math.max(...band) / Math.max(1, Math.min(...band)), '正经打法间分数极差').toBeLessThan(2.2)
  // 摆烂必须明显吃亏（惩罚路径要疼）
  const lazy = aggs.get('human·狠活摆烂')!.score / Math.max(1, aggs.get('human·狠活摆烂')!.n)
  const best = Math.max(...band)
  expect(lazy, '摆烂狠活应明显落后正经打法').toBeLessThan(best * 0.7)
})
