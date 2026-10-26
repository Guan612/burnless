import { describe, expect, it } from 'vitest'
import { ManualClock } from '../src/clock'
import { MatchActor } from '../src/match-actor'
import type { ClientMessage, ServerMessage } from '../src/protocol'
import type { SimSnapshot } from '../src/sim/types'
import type { SeatRating, SeatResultRecord } from '../src/match-actor'

function setup(
  seatCount = 3,
  onEnded?: (records: SeatResultRecord[]) => Promise<SeatRating[]>,
  opts?: { autoStartS?: number },
) {
  let tokenSeq = 0
  const actor = new MatchActor(new ManualClock(), {
    seed: 42,
    seatCount,
    newToken: () => `tok-${++tokenSeq}`,
    ...(onEnded ? { onEnded } : {}),
    ...(opts ?? {}),
  })
  const inbox = new Map<string, ServerMessage[]>()
  /** 挂载连接并发送首条消息（hello / resume），返回收到的消息列表；verified = 传输壳验证过的身份 */
  const connect = (id: string, first: ClientMessage, verified?: { id: string } | null): ServerMessage[] => {
    inbox.set(id, [])
    actor.attach(id, (m) => inbox.get(id)!.push(m), verified)
    actor.message(id, first)
    return inbox.get(id)!
  }
  return { actor, inbox, connect }
}

function welcome(msgs: ServerMessage[]): Extract<ServerMessage, { type: 'match_welcome' }> {
  const w = msgs.find((m) => m.type === 'match_welcome')
  if (!w || w.type !== 'match_welcome') throw new Error('未收到 match_welcome')
  return w
}

/** 最后一条快照（等待开局测试用：phase 翻转都走 snap 下发） */
function lastSnap(msgs: ServerMessage[]): SimSnapshot {
  const s = msgs.filter((m) => m.type === 'snap').at(-1)
  if (!s || s.type !== 'snap') throw new Error('未收到 snap')
  return s.snap
}

describe('MatchActor 对局房内核（W4 服务器权威）', () => {
  it('hello 入座：座位随机分配，三人各占一摊，满员转观战', () => {
    const { connect } = setup()
    const w0 = welcome(connect('a', { type: 'hello' }))
    const w1 = welcome(connect('b', { type: 'hello' }))
    const w2 = welcome(connect('c', { type: 'hello' }))
    // 随机分配：不按座号顺序，但三人恰好占满三个不同座位
    expect(new Set([w0.seatId, w1.seatId, w2.seatId])).toEqual(new Set(['seat-0', 'seat-1', 'seat-2']))
    expect(w0.spectating).toBe(false)
    expect(w0.seatToken).toBe('tok-1')
    expect(w0.snap.phase).toBe('running')

    const w3 = welcome(connect('d', { type: 'hello' }))
    expect(w3.seatId).toBeNull()
    expect(w3.spectating).toBe(true)
  })

  it('resume 续座：断线重连拿回原座位与状态（W4 验收核心）', () => {
    const { actor, inbox, connect } = setup()
    const w0 = welcome(connect('a', { type: 'hello' }))
    const token = w0.seatToken!
    actor.message('a', { type: 'intent', intent: { kind: 'price', value: 9 } })
    actor.leave('a')

    inbox.set('a2', [])
    actor.attach('a2', (m) => inbox.get('a2')!.push(m))
    actor.message('a2', { type: 'resume', token })

    const w2 = welcome(inbox.get('a2')!)
    expect(w2.seatId).toBe(w0.seatId) // 续座：拿回随机分配时的原座位
    expect(w2.spectating).toBe(false)
    expect(w2.snap.price).toBe(9) // 状态原样保留
    expect(w2.seatToken).toBe(token)
  })

  it('无效续座令牌自动降级为新座位（服务器重启后的兜底）', () => {
    const { connect } = setup()
    const w0 = welcome(connect('a', { type: 'hello' }))
    const w = welcome(connect('b', { type: 'resume', token: 'bad-token' }))
    expect(w.seatId).not.toBe(w0.seatId) // 随机开新座，绝不抢已认领的摊
    expect(w.seatToken).toBe('tok-2')
  })

  it('intent 即时回个人快照；观战者 intent 被拒', () => {
    const { actor, inbox, connect } = setup()
    welcome(connect('a', { type: 'hello' }))
    connect('b', { type: 'hello' })
    connect('c', { type: 'hello' })
    connect('spec', { type: 'hello' })

    actor.message('spec', { type: 'intent', intent: { kind: 'price', value: 9 } })
    expect(inbox.get('spec')).toContainEqual(expect.objectContaining({ type: 'error', message: 'no seat' }))

    const before = inbox.get('a')!.length
    actor.message('a', { type: 'intent', intent: { kind: 'price', value: 9 } })
    const aMsgs = inbox.get('a')!.slice(before)
    const snap = aMsgs.find((m) => m.type === 'snap')
    expect(snap && snap.type === 'snap' && snap.snap.price).toBe(9)
    // 别的座位不会收到 a 的个人快照
    expect(inbox.get('b')!.some((m) => m.type === 'snap' && m.snap.price === 9)).toBe(false)
  })

  it('tick 推进模拟并逐座位分发快照与事件，座位事件不串台', () => {
    const { actor, inbox, connect } = setup()
    const seatOf: Record<string, string> = {}
    seatOf.a = welcome(connect('a', { type: 'hello' })).seatId!
    seatOf.b = welcome(connect('b', { type: 'hello' })).seatId!

    actor.tick(3, 30) // 认领后 ~2s 开首个进货窗口 → restock_open（maxDt 放开追帧）

    for (const id of ['a', 'b'] as const) {
      const msgs = inbox.get(id)!
      const snaps = msgs.filter((m) => m.type === 'snap')
      expect(snaps.length).toBeGreaterThan(0)
      const mine = (snaps.at(-1)! as Extract<ServerMessage, { type: 'snap' }>).snap
      const mineStalls = mine.stalls.filter((s) => s.isPlayer)
      expect(mineStalls).toHaveLength(1)
      expect(mineStalls[0]!.id).toBe(seatOf[id])
      // 进货窗口事件只发本座位
      const events = msgs.filter((m) => m.type === 'events').flatMap((m) => (m.type === 'events' ? m.events : []))
      expect(events.some((e) => e.kind === 'restock_open' && e.seat === mineStalls[0]!.id)).toBe(true)
      expect(events.every((e) => !e.seat || e.seat === mineStalls[0]!.id)).toBe(true)
    }
  })

  it('回声房消息在对局房非法：回 error 且不入座', () => {
    const { actor, inbox, connect } = setup()
    connect('a', { type: 'echo', text: '烤腰子' })
    const msgs = inbox.get('a')!
    expect(msgs).toContainEqual(expect.objectContaining({ type: 'error' }))
    expect(msgs.some((m) => m.type === 'match_welcome')).toBe(false)
  })

  it('W5 主动动作 intent：verify/report/smear 直通模拟核心', () => {
    const { actor, inbox, connect } = setup()
    welcome(connect('a', { type: 'hello' }))
    welcome(connect('b', { type: 'hello' }))
    welcome(connect('c', { type: 'hello' }))
    const before = inbox.get('a')!.length

    actor.message('a', { type: 'intent', intent: { kind: 'verify' } }) // 无嫌疑：静默拒绝（不算非法帧）
    actor.message('a', { type: 'intent', intent: { kind: 'report', target: 'seat-1' } }) // 有冷却与落空分支，但解析合法
    actor.message('a', { type: 'intent', intent: { kind: 'smear', target: 'seat-2' } })

    const errs = inbox.get('a')!.slice(before).filter((m) => m.type === 'error')
    expect(errs).toHaveLength(0) // 三种新 intent 都是合法帧
  })

  it('W6 局外闭环：带身份入座 → 整局结束 → onEnded 收到结算、段位回填进快照', async () => {
    const seen: SeatResultRecord[] = []
    const { actor, inbox, connect } = setup(3, async (records) => {
      seen.push(...records)
      return records.map((r) => ({ seatId: r.seatId, old: 500, after: 777 }))
    })
    welcome(connect('a', { type: 'hello', player: { id: 'user-a', name: '高分手' } }))
    // 推进到首个进货窗口，进一笔良心货，再一口气跑到自然结束
    actor.tick(2.5, 2.5)
    actor.message('a', { type: 'intent', intent: { kind: 'restock', honestShare: 1 } })
    actor.tick(600, 600)
    await Promise.resolve() // onEnded 是 fire-and-forget promise，让微队列跑完
    await Promise.resolve()

    expect(actor.running).toBe(false)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.playerId).toBe('user-a')
    expect(seen[0]!.result.score).toBeGreaterThan(0)

    // 段位变化回填进该座位的最终快照
    const finalSnap = inbox
      .get('a')!
      .filter((m) => m.type === 'snap')
      .at(-1)
    expect(finalSnap && finalSnap.type === 'snap' && finalSnap.snap.result?.rating).toEqual({ old: 500, after: 777 })
  })

  it('无身份的座位不进 onEnded（观战/游客不落库）', async () => {
    const seen: SeatResultRecord[] = []
    const { actor, connect } = setup(3, async (records) => {
      seen.push(...records)
      return []
    })
    welcome(connect('a', { type: 'hello' })) // 无 player
    actor.tick(600, 600)
    await Promise.resolve()
    await Promise.resolve()
    expect(seen).toHaveLength(0)
  })

  it('等待开局：autoStartS 进 waiting 房，人齐自动开局、等待期 intent 拒绝', () => {
    const { actor, connect } = setup(3, undefined, { autoStartS: 60 })
    const w0 = welcome(connect('a', { type: 'hello' }))
    expect(w0.snap.phase).toBe('waiting')
    expect(w0.snap.waitingLeftS).toBe(60)
    expect(w0.host).toBe(true) // 首个入座者 = 房主

    // 等待期不能操作（营业还没开始）
    const w1 = welcome(connect('b', { type: 'hello' }))
    expect(w1.host).toBe(false)

    // 人齐（第 3 人落座）→ 立即翻转 running
    const w2 = welcome(connect('c', { type: 'hello' }))
    expect(w2.snap.phase).toBe('running')
    expect(w2.snap.waitingLeftS).toBeNull()
    expect(actor.running).toBe(true)
  })

  it('等待开局：房主可提前开局，非房主无效，倒计时到点兜底', () => {
    const { actor, inbox, connect } = setup(3, undefined, { autoStartS: 30 })
    welcome(connect('a', { type: 'hello' })) // 房主
    const bMsgs = connect('b', { type: 'hello' })

    actor.message('b', { type: 'start' }) // 非房主：静默无效
    actor.tick(1, 1) // 走一拍：b 收到的快照仍在等待
    expect(lastSnap(bMsgs).phase).toBe('waiting')

    actor.message('a', { type: 'start' }) // 房主开局：立刻广播 running 快照
    expect(lastSnap(bMsgs).phase).toBe('running')
    expect(lastSnap(bMsgs).waitingLeftS).toBeNull()

    // 倒计时兜底：全新房间没人点开局，等秒数走完也开
    const { actor: actor2, connect: connect2 } = setup(3, undefined, { autoStartS: 10 })
    const a2Msgs = connect2('a', { type: 'hello' })
    expect(welcome(a2Msgs).snap.phase).toBe('waiting')
    actor2.tick(10.5, 10.5)
    expect(lastSnap(a2Msgs).phase).toBe('running')
  })

  it('等待开局：朋友进屋接管 bot 摊在 waiting 阶段也允许（claim 放宽）', () => {
    const { connect } = setup(3, undefined, { autoStartS: 60 })
    const w0 = welcome(connect('a', { type: 'hello' }))
    const w = welcome(connect('b', { type: 'hello' }))
    expect(w.seatId).not.toBe(w0.seatId) // 等待期随机分配空位，不会满员转观战
    expect(w.snap.stalls.find((s) => s.id === w.seatId)!.human).toBe(true)
  })
})

describe('MatchActor 身份裁决（服务端验证覆盖客户端自报）', () => {
  it('壳注入已验证身份：结算落库认会话 id，hello 自报的伪造 id 作废', async () => {
    const seen: SeatResultRecord[] = []
    const { actor, connect } = setup(3, async (records) => {
      seen.push(...records)
      return records.map((r) => ({ seatId: r.seatId, old: 500, after: 501 }))
    })
    // 攻击者自报受害者 id，但壳层验证出的会话是 attacker-session
    welcome(connect('a', { type: 'hello', player: { id: 'victim-id', name: '受害者' } }, { id: 'attacker-session' }))
    actor.tick(2.5, 2.5)
    actor.message('a', { type: 'intent', intent: { kind: 'restock', honestShare: 1 } })
    actor.tick(600, 600)
    await Promise.resolve()
    await Promise.resolve()

    expect(seen).toHaveLength(1)
    expect(seen[0]!.playerId).toBe('attacker-session') // 落库的是会话 id，不是自报的 victim-id
  })

  it('壳验证为无会话（null）：可入座可玩，但自报身份作废、结算不落库', async () => {
    const seen: SeatResultRecord[] = []
    const { actor, connect } = setup(3, async (records) => {
      seen.push(...records)
      return []
    })
    const w = welcome(connect('a', { type: 'hello', player: { id: 'fake-id' } }, null))
    expect(w.spectating).toBe(false) // 有座位
    actor.tick(600, 600)
    await Promise.resolve()
    await Promise.resolve()
    expect(seen).toHaveLength(0) // 自报 id 不被采信
  })

  it('resume 防偷座：他人拿令牌续座被拒（身份对不上 → 降级新座位）', () => {
    const { connect } = setup(3)
    const w0 = welcome(connect('a', { type: 'hello', player: { id: 'user-a' } }))
    const token = w0.seatToken!

    // 攻击者持有受害者令牌，但会话身份对不上
    const wThief = welcome(connect('b', { type: 'resume', token, player: { id: 'user-b' } }, { id: 'user-b' }))
    expect(wThief.seatId).not.toBe(w0.seatId)
    expect(wThief.seatToken).not.toBe(token) // 发的是新令牌

    // 本人重连：同会话身份，令牌仍有效
    const wSelf = welcome(connect('a2', { type: 'resume', token }, { id: 'user-a' }))
    expect(wSelf.seatId).toBe(w0.seatId)
  })

  it('resume 防偷座：无会话者也不能续有主座位', () => {
    const { connect } = setup(3)
    const w0 = welcome(connect('a', { type: 'hello', player: { id: 'user-a' } }, { id: 'user-a' }))
    const token = w0.seatToken!

    const wGuest = welcome(connect('g', { type: 'resume', token }, null))
    expect(wGuest.seatId).not.toBe(w0.seatId)
  })

  it('未做验证的壳（verified undefined，纯测试环境）：沿用信任自报的旧行为', () => {
    const { connect } = setup(3)
    const w0 = welcome(connect('a', { type: 'hello', player: { id: 'user-a' } }))
    const token = w0.seatToken!
    // 旧壳语义：同 id 续座成功
    const w2 = welcome(connect('a2', { type: 'resume', token, player: { id: 'user-a' } }))
    expect(w2.seatId).toBe(w0.seatId)
  })
})
