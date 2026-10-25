// 星露谷式 3/4 俯视夜市街景（决策 #20）。布局常量与 packages/sprites/src/preview.mjs 保持一致。
import { Application, Container, Graphics, Rectangle, Sprite, Text, type Ticker } from 'pixi.js'
import { frame, loadAtlas } from './atlas'

const TILE = 16
const COLS = 15
const STAGE_W = COLS * TILE // 240
const STAGE_H = 160
const GROUND_Y = 68 // 天空/地面分界（上人行道北缘）
const FOOT_Y = 84 // 摊位/灯柱脚线（上人行道南缘）

const STALLS = [
  { x: 12, variant: 'red' },
  { x: 88, variant: 'teal' },
  { x: 164, variant: 'gold' },
] as const
const POLES = [60, 136] as const

const NIGHT = [0x191320, 0x221a29, 0x2d2130, 0x3a2a35]
const SILHOUETTE = 0x120d15
const WINDOW = 0xe8b04b
const ROAD_DASH = 0x6e6355

function lcg(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0
    return a / 0x100000000
  }
}

function flicker(t: number, phase: number) {
  return 0.82 + 0.12 * Math.sin(t * 6 + phase) + 0.06 * Math.sin(t * 11 + phase * 2)
}

interface UpdatableView {
  root: Container
  update(t: number): void
}

// ---------- 场景构件 ----------

function buildSky(parent: Container): void {
  const g = new Graphics()
  const bandH = GROUND_Y / NIGHT.length
  NIGHT.forEach((c, i) => g.rect(0, i * bandH, STAGE_W, bandH + 1).fill(c))
  const rng = lcg(7)
  for (let i = 0; i < 6; i++) {
    const bw = 28 + Math.floor(rng() * 34)
    const bh = 16 + Math.floor(rng() * 40)
    const bx = Math.floor(rng() * (STAGE_W - bw))
    const by = GROUND_Y - bh
    g.rect(bx, by, bw, bh).fill(SILHOUETTE)
    for (let wy = by + 3; wy < by + bh - 3; wy += 4) {
      for (let wx = bx + 3; wx < bx + bw - 3; wx += 4) {
        if (rng() < 0.3) g.rect(wx, wy, 1, 1).fill({ color: WINDOW, alpha: 0.85 })
      }
    }
  }
  parent.addChild(g)
}

function buildGround(parent: Container): void {
  const rows = [
    { y: 68, name: 'ground/walk' },
    { y: 84, name: 'ground/road' },
    { y: 100, name: 'ground/road' },
    { y: 116, name: 'ground/walk' },
    { y: 132, name: 'ground/walk' },
    { y: 148, name: 'ground/walk' },
  ] as const
  for (const row of rows) {
    for (let c = 0; c < COLS; c++) {
      const s = new Sprite(frame(row.name))
      s.position.set(c * TILE, row.y)
      parent.addChild(s)
    }
  }
  const g = new Graphics()
  for (let x0 = 0; x0 < STAGE_W; x0 += 32) {
    g.rect(x0 + 6, 99, 10, 2).fill({ color: ROAD_DASH, alpha: 0.7 })
  }
  parent.addChild(g)
}

function makeStall(x: number, variant: 'red' | 'teal' | 'gold'): UpdatableView {
  const root = new Container()
  root.position.set(x + 32, FOOT_Y)
  root.zIndex = FOOT_Y

  const sprite = new Sprite(frame(`stall/${variant}`))
  sprite.anchor.set(0.5, 1)
  root.addChild(sprite)

  const lanternGlow = new Sprite(frame('fx/glow'))
  lanternGlow.anchor.set(0.5)
  lanternGlow.blendMode = 'add'
  lanternGlow.tint = 0xff9c5a
  lanternGlow.position.set(28, -57)
  lanternGlow.scale.set(1.15)
  root.addChild(lanternGlow)

  const emberGlow = new Sprite(frame('fx/glow'))
  emberGlow.anchor.set(0.5)
  emberGlow.blendMode = 'add'
  emberGlow.tint = 0xff7832
  emberGlow.position.set(1, -35)
  emberGlow.scale.set(1.35)
  root.addChild(emberGlow)

  const smokes = [0, 1].map((i) => {
    const s = new Sprite(frame('fx/smoke'))
    s.anchor.set(0.5)
    s.position.set(-4 + i * 7, -80 - i * 8)
    root.addChild(s)
    return s
  })

  return {
    root,
    update(t: number) {
      lanternGlow.alpha = 0.55 * flicker(t, 1.3)
      emberGlow.alpha = 0.5 * flicker(t, 2.1)
      smokes.forEach((s, i) => {
        const p = ((t + i * 1.3) % 2.6) / 2.6
        s.y = -80 - i * 8 - p * 14
        s.x = -4 + i * 7 + Math.sin(t * 1.7 + i * 2.6) * 2
        s.alpha = Math.sin(Math.PI * p) * 0.4
        s.scale.set(0.9 + p * 0.5)
      })
    },
  }
}

function makePole(px: number): UpdatableView {
  const root = new Container()
  root.position.set(px + 4, FOOT_Y)
  root.zIndex = FOOT_Y

  const sprite = new Sprite(frame('prop/pole'))
  sprite.anchor.set(0.5, 1)
  root.addChild(sprite)

  const glow = new Sprite(frame('fx/glow'))
  glow.anchor.set(0.5)
  glow.blendMode = 'add'
  glow.tint = 0xff9c5a
  glow.position.set(0, -36)
  glow.scale.set(0.75)
  root.addChild(glow)

  return {
    root,
    update(t: number) {
      glow.alpha = 0.6 * flicker(t, 3.7)
    },
  }
}

const NPC_VARIANTS = ['red', 'teal', 'gold', 'plum'] as const
const NPC_BANDS = [
  { min: 76, max: 82 }, // 上人行道（摊位身后）
  { min: 96, max: 112 }, // 马路
  { min: 122, max: 154 }, // 下人行道
] as const

/** 排队位（相对摊位中心的横向排开 + 台面前一线，比摊位脚线低所以 zIndex 压过摊身） */
const QUEUE_MAX = 6 // 每摊专职排队位：跟 sim queueLen 一一对应（超出部分的人不在台上演）
const SLOTS_DX = [-20, -12, -4, 4, 12, 20] as const
const SLOTS_DY = [89, 91, 90, 92, 89, 91] as const

class NpcActor {
  view = new Container()
  private body: Sprite
  private variant: (typeof NPC_VARIANTS)[number]
  private x: number
  private y: number
  private tx = 0
  private ty = 0
  private speed: number
  private wait = 0
  private animT = 0
  private rng: () => number

  constructor(rng: () => number) {
    this.rng = rng
    this.variant = NPC_VARIANTS[Math.floor(rng() * NPC_VARIANTS.length)] ?? 'red'
    this.x = 8 + rng() * (STAGE_W - 16)
    const band = NPC_BANDS[Math.floor(rng() * NPC_BANDS.length)] ?? NPC_BANDS[0]
    this.y = band.min + rng() * (band.max - band.min)
    this.speed = 10 + rng() * 10

    const shadow = new Sprite(frame('fx/shadow'))
    shadow.anchor.set(0.5, 0.5)
    shadow.position.set(0, -2)
    this.body = new Sprite(frame(`npc/${this.variant}/0`))
    this.body.anchor.set(0.5, 1)
    this.view.addChild(shadow, this.body)
    this.pickTarget()
    this.wait = rng() * 2
  }

  update(dt: number, _t: number): void {
    this.animT += dt
    if (this.wait > 0) {
      this.wait -= dt
      this.body.texture = frame(`npc/${this.variant}/0`)
    } else {
      const dx = this.tx - this.x
      const dy = this.ty - this.y
      const dist = Math.hypot(dx, dy)
      if (dist < 1) {
        this.pickTarget()
        this.wait = this.rng() * 2
      } else {
        const step = Math.min(this.speed * dt, dist)
        this.x += (dx / dist) * step
        this.y += (dy / dist) * step
        const f = (Math.floor(this.animT / 0.16) % 2) as 0 | 1
        this.body.texture = frame(`npc/${this.variant}/${f}`)
      }
    }
    this.view.position.set(this.x, this.y)
    this.view.zIndex = this.y
  }

  private pickTarget(): void {
    const band = NPC_BANDS[Math.floor(this.rng() * NPC_BANDS.length)] ?? NPC_BANDS[0]
    this.tx = 8 + this.rng() * (STAGE_W - 16)
    this.ty = band.min + this.rng() * (band.max - band.min)
  }
}

/**
 * 专职排队小人：每摊 QUEUE_MAX 个固定角色，第 k 位亮不亮严格等于「queueLen > k」——
 * 数字与画面永不错位（1s 一拍的快照延迟内），淡入淡出只做过渡。闲逛人流另由 NpcActor 扮演
 */
class QueueSlotActor {
  view = new Container()
  private baseY = 90
  private alpha = 0
  private phase: number

  constructor(rng: () => number) {
    this.phase = rng() * Math.PI * 2
    const variant = NPC_VARIANTS[Math.floor(rng() * NPC_VARIANTS.length)] ?? 'red'
    const shadow = new Sprite(frame('fx/shadow'))
    shadow.anchor.set(0.5, 0.5)
    shadow.position.set(0, -2)
    const body = new Sprite(frame(`npc/${variant}/0`))
    body.anchor.set(0.5, 1)
    this.view.addChild(shadow, body)
    this.view.visible = false
    this.view.alpha = 0
  }

  place(cx: number, k: number): void {
    const x = cx + (SLOTS_DX[k] ?? 0)
    this.baseY = SLOTS_DY[k] ?? 90
    this.view.position.set(x, this.baseY)
    this.view.zIndex = this.baseY
  }

  update(dt: number, t: number, filled: boolean): void {
    this.alpha += ((filled ? 1 : 0) - this.alpha) * Math.min(1, dt * 8)
    this.view.alpha = this.alpha
    this.view.visible = this.alpha > 0.02
    if (this.view.visible) this.view.y = this.baseY + Math.sin(t * 2.4 + this.phase) * 0.5
  }
}

// ---------- 对局数据驱动的表现层 ----------

/** 每个摊位的对外表现数据（由 StreetTab 从 SimSnapshot 折算） */
export interface StreetStall {
  name: string
  /** 真人摊主名；null = bot 代打 */
  ownerName: string | null
  isPlayer: boolean
  human: boolean
  queueLen: number
  closedForS: number
}

export interface StreetMatchState {
  stalls: StreetStall[]
}

const PLATE_H = 16

/** 摊位门牌：贴柜台前脸的小尺寸双行牌（名字 + 状态），宽度随名字自适应 */
function makePlate(cx: number): UpdatableView & { set: (s: StreetStall) => void } {
  const root = new Container()
  // 对齐柜台前脸自带的小铜牌（FOOT_Y-20.4 ~ -10.5），底边不压桌腿
  root.position.set(cx, FOOT_Y - 24)
  // 压过摊身（zIndex 84），但排在台前排队小人（y≥88）之后：他们站在门前，门牌不该盖住人
  root.zIndex = FOOT_Y + 1
  root.visible = false

  const bg = new Graphics()
  const marker = new Graphics()
  marker.moveTo(-4, -7).lineTo(4, -7).lineTo(0, -1).closePath().fill(0xe8b04b)
  marker.visible = false
  const name = new Text({
    text: '',
    style: { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 7, fill: 0xfff3dd },
  })
  name.anchor.set(0.5, 0)
  name.position.set(0, 1)
  name.resolution = 4 // 门牌随世界放大数倍：预渲高分辨率防发虚
  const sub = new Text({
    text: '',
    style: { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 6, fill: 0x8f8478 },
  })
  sub.anchor.set(0.5, 0)
  sub.position.set(0, 8.5)
  sub.resolution = 4
  root.addChild(bg, marker, name, sub)

  return {
    root,
    set(s: StreetStall) {
      root.visible = true
      // 摊名截断到 8 字：门牌贴摊，不能宽过摊身太多
      name.text = s.name.length > 8 ? `${s.name.slice(0, 8)}…` : s.name
      let subText = ''
      let subColor = 0x8f8478
      if (s.closedForS > 0) {
        subText = '停业中'
        subColor = 0xff7a6b
      } else if (!s.human) {
        subText = 'bot 代打'
      } else if (s.isPlayer) {
        subText = '我的摊'
        subColor = 0x4a3610
      }
      sub.text = subText
      sub.visible = subText !== ''
      sub.style.fill = subColor
      name.style.fill = s.isPlayer ? 0x241807 : 0xfff3dd
      const w = Math.max(name.width, sub.visible ? sub.width : 0) + 10
      bg.clear()
      bg.roundRect(-w / 2, 0, w, PLATE_H, 3)
      if (s.isPlayer) {
        bg.fill({ color: 0xe8b04b, alpha: 0.94 })
      } else {
        bg.fill({ color: 0x241a12, alpha: 0.88 })
        bg.roundRect(-w / 2, 0, w, PLATE_H, 3).stroke({ color: 0x6b5236, width: 1, alpha: 0.85 })
      }
      marker.visible = s.isPlayer
    },
    update(t: number) {
      if (marker.visible) marker.y = -7 + Math.sin(t * 4) * 1.4
    },
  }
}

// ---------- 入口 ----------

export interface StreetHandle {
  destroy(): void
  /** 对局数据进场景：摊位名牌 + 台面前排队人数（queueLen 视觉化，每拍刷新） */
  setMatch(m: StreetMatchState | null): void
}

export async function initStreet(
  host: HTMLElement,
  onFps: (fps: number) => void,
  onStallClick?: (stallIndex: number, at: { x: number; y: number; hw: number }) => void,
): Promise<StreetHandle> {
  await loadAtlas()

  // W7 手机端性能降级：触屏 / 核心数少的设备降分辨率、减 NPC（渲染负载大头是 fill rate）
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  const lowEnd = coarse || (navigator.hardwareConcurrency ?? 8) <= 4

  const app = new Application()
  await app.init({
    width: Math.max(host.clientWidth, 320),
    height: Math.max(host.clientHeight, 200),
    background: NIGHT[0],
    antialias: false,
    resolution: Math.min(window.devicePixelRatio || 1, lowEnd ? 1.5 : 2),
    autoDensity: true,
    powerPreference: 'high-performance',
  })
  host.appendChild(app.canvas)

  const world = new Container()
  app.stage.addChild(world)

  buildSky(world)
  buildGround(world)

  const actors = new Container()
  actors.sortableChildren = true
  world.addChild(actors)

  const updatables: UpdatableView[] = []
  for (const [i, s] of STALLS.entries()) {
    const v = makeStall(s.x, s.variant)
    // 点摊位看摊内情况（价格/口碑/排队/烧心值）：命中区盖住整个摊身；
    // 回调带摊身中心的屏幕坐标（含半宽），供详情卡贴着摊位弹出
    v.root.eventMode = 'static'
    v.root.cursor = 'pointer'
    v.root.hitArea = new Rectangle(-32, -72, 64, 72)
    v.root.on('pointerdown', () => {
      onStallClick?.(
        i,
        {
          x: world.position.x + (s.x + 32) * world.scale.x,
          y: world.position.y + (FOOT_Y - 32) * world.scale.y,
          hw: 32 * world.scale.x,
        },
      )
    })
    updatables.push(v)
    actors.addChild(v.root)
  }
  for (const p of POLES) {
    const v = makePole(p)
    updatables.push(v)
    actors.addChild(v.root)
  }
  // 名牌压在一切演员之上（zIndex 999），拿到首帧对局数据前不显示
  const plates = STALLS.map((s) => {
    const p = makePlate(s.x + 32)
    actors.addChild(p.root)
    updatables.push(p)
    return p
  })

  const rng = lcg(20261025)
  const npcs: NpcActor[] = []
  for (let i = 0; i < (lowEnd ? 7 : 12); i++) {
    const n = new NpcActor(rng)
    npcs.push(n)
    actors.addChild(n.view)
  }

  // ---------- 排队专职位：第 k 位亮不亮严格等于「queueLen > k」，数字与画面永不错位 ----------
  const queueSlots: QueueSlotActor[][] = STALLS.map((s) => {
    const cx = s.x + 32
    return SLOTS_DX.map((_, k) => {
      const q = new QueueSlotActor(rng)
      q.place(cx, k)
      actors.addChild(q.view)
      return q
    })
  })
  const queueTargets = STALLS.map(() => 0)

  // 暗角：屏幕空间覆盖层（不随世界缩放）
  const vignette = new Sprite(frame('fx/vignette'))
  app.stage.addChild(vignette)

  function layout(): void {
    const w = Math.max(host.clientWidth, 160)
    const h = Math.max(host.clientHeight, 120)
    app.renderer.resize(w, h)
    const raw = Math.min(w / STAGE_W, h / STAGE_H)
    const scale = Math.max(1, Math.floor(raw * 4) / 4) // 0.25 步进，像素更整齐
    world.scale.set(scale)
    world.position.set(Math.round((w - STAGE_W * scale) / 2), Math.round((h - STAGE_H * scale) / 2))
    vignette.width = w
    vignette.height = h
  }
  layout()
  const ro = new ResizeObserver(layout)
  ro.observe(host)

  let elapsed = 0
  let fpsAcc = 0
  let destroyed = false
  const tick = (ticker: Ticker): void => {
    if (destroyed) return
    const dt = Math.min(ticker.deltaMS / 1000, 0.1)
    elapsed += dt
    for (const u of updatables) u.update(elapsed)
    for (const n of npcs) n.update(dt, elapsed)
    for (const [i, slots] of queueSlots.entries()) {
      const target = queueTargets[i] ?? 0
      for (const [k, slot] of slots.entries()) slot.update(dt, elapsed, k < target)
    }
    fpsAcc += ticker.deltaMS
    if (fpsAcc >= 500) {
      fpsAcc = 0
      onFps(Math.round(ticker.FPS))
    }
  }
  app.ticker.add(tick)

  return {
    destroy() {
      if (destroyed) return
      destroyed = true
      ro.disconnect()
      app.ticker.remove(tick)
      app.destroy(true, { children: true, texture: false, textureSource: false })
    },
    setMatch(m: StreetMatchState | null): void {
      if (!m) {
        queueTargets.fill(0)
        for (const p of plates) p.root.visible = false
        return
      }
      m.stalls.slice(0, plates.length).forEach((s, i) => {
        plates[i]!.set(s)
        queueTargets[i] = Math.min(QUEUE_MAX, s.queueLen)
      })
    },
  }
}
