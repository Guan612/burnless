/**
 * 房间时钟抽象：内核逻辑不许直接摸 Date.now / setTimeout，
 * 一切时间经过注入的 RoomClock——这样确定性模拟、回放和测试才有立足点（决策 #9 的确定性模拟前置）。
 */
export interface RoomClock {
  now(): number
}

/** 真实时钟（DO / Node 运行时用） */
export class WallClock implements RoomClock {
  now(): number {
    return Date.now()
  }
}

/** 手动时钟（测试 / 回放用） */
export class ManualClock implements RoomClock {
  private current = 0

  now(): number {
    return this.current
  }

  advance(ms: number): number {
    this.current += ms
    return this.current
  }

  setTo(t: number): void {
    this.current = t
  }
}
