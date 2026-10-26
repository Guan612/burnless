import { describe, expect, it } from 'vitest'
import { ManualClock } from '../src/clock'
import { PROTOCOL_VERSION, type ServerMessage } from '../src/protocol'
import { RoomActor } from '../src/room-actor'

function setup(options?: ConstructorParameters<typeof RoomActor>[1]) {
  const clock = new ManualClock()
  const actor = new RoomActor(clock, options)
  const inbox = new Map<string, ServerMessage[]>()
  const join = (id: string) => {
    inbox.set(id, [])
    return actor.join(id, (m) => inbox.get(id)!.push(m))
  }
  return { clock, actor, inbox, join }
}

describe('RoomActor 回声房内核', () => {
  it('新玩家收到 welcome（含协议版本与历史），老玩家收到 joined 广播', () => {
    const { actor, inbox, join } = setup()
    join('a')
    actor.message('a', { type: 'echo', text: '第一条' })

    const welcome = join('b')
    expect(welcome.protocol).toBe(PROTOCOL_VERSION)
    expect(welcome.you).toBe('b')
    expect(welcome.history).toHaveLength(1)
    expect(inbox.get('a')).toContainEqual(expect.objectContaining({ type: 'joined', id: 'b' }))
  })

  it('echo 广播给全员且 seq 单调，历史入档', () => {
    const { actor, inbox, join } = setup()
    join('a')
    join('b')
    actor.message('a', { type: 'echo', text: '烤腰子' })
    actor.message('b', { type: 'echo', text: '多放辣' })

    const aMsgs = inbox.get('a')!
    const echoes = aMsgs.filter((m) => m.type === 'echo')
    expect(echoes).toHaveLength(2)
    expect(echoes[0]).toMatchObject({ seq: 1, from: 'a', text: '烤腰子' })
    expect(echoes[1]).toMatchObject({ seq: 2, from: 'b', text: '多放辣' })
  })

  it('leave 广播离场', () => {
    const { clock, actor, inbox, join } = setup()
    join('a')
    join('b')
    clock.advance(1000)
    actor.leave('b')
    expect(inbox.get('a')).toContainEqual(expect.objectContaining({ type: 'left', id: 'b', at: 1000 }))
  })

  it('非法消息回 error，不进历史', () => {
    const { actor, inbox, join } = setup()
    join('a')
    actor.message('a', { type: 'echo', text: '' }) // 空文本
    actor.message('a', { type: 'hack', text: 'x' }) // 未知类型
    actor.message('a', 'not an object')

    const errs = inbox.get('a')!.filter((m) => m.type === 'error')
    expect(errs).toHaveLength(3)
  })

  it('历史有上限，新加入者只拿到最近 N 条', () => {
    const { actor, join } = setup({ historyLimit: 3 })
    join('a')
    for (let i = 1; i <= 5; i++) actor.message('a', { type: 'echo', text: `msg-${i}` })

    const welcome = join('b')
    expect(welcome.history).toHaveLength(3)
    expect(welcome.history.map((e) => e.text)).toEqual(['msg-3', 'msg-4', 'msg-5'])
  })

  it('echo 节流：1s 窗口内超 5 条被丢弃并回错误帧，窗口滑过恢复', () => {
    const { clock, actor, inbox, join } = setup()
    join('a')
    join('b') // 观察广播是否被抑制

    for (let i = 1; i <= 5; i++) actor.message('a', { type: 'echo', text: `ok-${i}` })
    actor.message('a', { type: 'echo', text: 'dropped' })

    const aMsgs = inbox.get('a')!
    const echoes = aMsgs.filter((m) => m.type === 'echo')
    expect(echoes).toHaveLength(5) // 第 6 条没广播
    expect(aMsgs).toContainEqual(expect.objectContaining({ type: 'error', message: 'too many messages' }))
    expect(inbox.get('b')!.filter((m) => m.type === 'echo')).toHaveLength(5)

    clock.advance(1000) // 窗口滑过 → 恢复放行
    actor.message('a', { type: 'echo', text: 'again' })
    expect(inbox.get('b')!.filter((m) => m.type === 'echo')).toHaveLength(6)
  })

  it('echo 节流计数随 leave 清理，不泄漏', () => {
    const { actor, inbox, join } = setup()
    join('a')
    for (let i = 1; i <= 5; i++) actor.message('a', { type: 'echo', text: `ok-${i}` })
    actor.leave('a')
    join('a') // 同 id 重进：计数已清零
    actor.message('a', { type: 'echo', text: 'fresh' })
    expect(inbox.get('a')!.filter((m) => m.type === 'echo').some((m) => m.text === 'fresh')).toBe(true)
  })
})
