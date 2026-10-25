// sprite 画笔：每个函数 = 一张代码像素画。坐标原点都是帧左上角。
import { Px, mulberry32 } from './lib.mjs'
import { C, STALL_VARIANTS, NPC_VARIANTS } from './palette.mjs'

/**
 * 16x16 方格地砖（星露谷式 3/4 俯视，决策 #20）。
 * 地砖必须无缝平铺：只画均匀纹理，不在边缘画终止线。
 */
export function drawRoadTile(P) {
  const rng = mulberry32(101)
  P.rect(0, 0, 16, 16, C.road)
  for (let i = 0; i < 7; i++) {
    const x = Math.floor(rng() * 16)
    const y = Math.floor(rng() * 16)
    P.set(x, y, rng() < 0.5 ? C.roadLit : C.roadDark)
  }
  // 一道短裂纹
  P.set(4, 9, C.roadDark)
  P.set(5, 10, C.roadDark)
  P.set(6, 10, C.roadDark)
}

export function drawWalkTile(P) {
  const rng = mulberry32(202)
  P.rect(0, 0, 16, 16, C.walk)
  // 8px 石板网格：缝画在 tile 左/上边缘，拼接连成网格
  P.hline(0, 15, 0, C.walkDark)
  P.vline(0, 0, 15, C.walkDark)
  P.hline(0, 15, 8, C.walkDark)
  P.vline(8, 0, 15, C.walkDark)
  // 缝缘高光（受光面）
  P.hline(0, 15, 1, C.walkLit)
  P.vline(1, 1, 7, C.walkLit)
  P.hline(0, 15, 9, C.walkLit)
  P.vline(9, 9, 15, C.walkLit)
  for (let i = 0; i < 4; i++) {
    const x = 2 + Math.floor(rng() * 13)
    const y = 2 + Math.floor(rng() * 13)
    P.set(x, y, rng() < 0.6 ? C.walkLit : C.walkDark)
  }
}

/**
 * 烧烤摊正面立面 64x78（星露谷式：只画正面，底边 y74 接地）。
 * 遮阳棚条纹 → 挂串后墙 → 台面烤炉炭火 → 招牌柜体 → 落地腿。
 */
export function drawStall(P, v) {
  const ink = C.ink

  // 落地腿
  P.rect(8, 58, 3, 16, C.woodDark)
  P.rect(53, 58, 3, 16, C.woodDark)
  P.hline(6, 12, 73, ink)
  P.hline(51, 57, 73, ink)

  // 柜体
  P.rect(5, 46, 54, 14, C.wood)
  P.vline(5, 46, 59, C.woodDark)
  P.vline(58, 46, 59, C.woodDark)
  P.hline(5, 58, 59, ink)
  // 招牌板 + 「不烧心」三笔墨
  P.rect(24, 49, 16, 9, v.main)
  P.hline(24, 39, 49, v.dark)
  P.vline(24, 49, 57, v.dark)
  P.hline(24, 39, 57, ink)
  P.vline(39, 49, 57, ink)
  P.vline(28, 51, 55, ink)
  P.hline(31, 35, 51, ink)
  P.vline(33, 51, 55, ink)
  P.set(32, 52, ink)
  P.set(36, 51, ink)
  P.hline(35, 37, 53, ink)

  // 台面（顶面受光）
  P.rect(4, 41, 56, 5, C.woodLight)
  P.hline(4, 59, 41, C.wood)
  P.hline(4, 59, 45, ink)

  // 烤炉炭槽
  P.rect(22, 37, 22, 5, ink)
  for (let x = 24; x < 42; x += 2) {
    P.set(x, 40, C.ember)
    if (x % 4 === 0) P.set(x, 39, C.emberHot)
  }

  // 后墙 + 挂串
  P.rect(8, 16, 48, 25, C.woodDark)
  P.rect(8, 16, 48, 1, C.wood)
  for (let i = 0; i < 4; i++) {
    const sx = 14 + i * 10
    P.vline(sx, 19, 27, C.woodLight)
    P.rect(sx - 1, 22, 3, 5, v.dark)
    P.set(sx, 23, C.ember)
    P.set(sx - 1, 25, C.emberHot)
  }
  // 菜牌
  P.rect(42, 20, 12, 11, C.canvas)
  P.hline(42, 53, 20, ink)
  P.hline(42, 53, 30, ink)
  P.vline(42, 20, 30, ink)
  P.vline(53, 20, 30, ink)
  P.hline(44, 51, 24, ink)
  P.hline(44, 49, 27, ink)

  // 支柱
  P.rect(4, 14, 3, 46, C.wood)
  P.rect(57, 14, 3, 46, C.wood)
  P.vline(4, 14, 59, ink)
  P.vline(59, 14, 59, ink)

  // 遮阳棚：条纹 + 扇贝边（正面视角，顶行压暗示顶面）
  for (let x = 2; x < 62; x++) {
    const stripe = Math.floor((x - 2) / 6) % 2 === 0
    const c = stripe ? v.main : C.canvas
    for (let y = 2; y <= 10; y++) P.set(x, y, c)
    P.set(x, 1, v.dark)
    const tooth = Math.floor((x - 2) / 4) % 2 === 0
    P.set(x, 11, tooth ? c : C.canvas)
    if (tooth) P.set(x, 12, c)
    P.set(x, 0, ink)
  }
  P.hline(2, 61, 11, v.dark)

  // 右柱挂灯笼
  P.vline(61, 12, 14, ink)
  P.rect(58, 14, 5, 7, C.lantern)
  P.hline(58, 62, 14, C.redDark)
  P.hline(58, 62, 20, C.redDark)
  P.set(60, 16, C.lanternLight)
  P.set(59, 15, C.lanternLight)
  P.vline(60, 21, 22, ink)
}

/** 灯柱 8x44（正面直杆 + 顶挂灯笼） */
export function drawPole(P) {
  const ink = C.ink
  P.vline(3, 6, 42, hex2('#4a3a2c'))
  P.vline(4, 6, 42, hex2('#332818'))
  P.hline(2, 5, 42, ink)
  P.hline(1, 6, 43, ink)
  // 顶灯
  P.vline(3, 0, 5, ink)
  P.vline(4, 0, 5, ink)
  P.rect(1, 5, 6, 7, C.lantern)
  P.hline(1, 6, 5, C.redDark)
  P.hline(1, 6, 11, C.redDark)
  P.set(3, 7, C.lanternLight)
  P.set(2, 6, C.lanternLight)
  P.set(4, 7, C.lanternLight)
}

/**
 * 顾客 12x17，两帧行走。正面微侧视角；f=0 站立/迈左，f=1 迈右。
 */
export function drawNpc(P, v, f) {
  const ink = C.ink
  // 头
  P.rect(4, 3, 5, 4, C.skin)
  P.set(4, 3, C.skinShade)
  P.set(4, 6, C.skinShade)
  // 头发
  P.hline(3, 8, 2, v.hair)
  P.rect(3, 3, 1, 2, v.hair)
  P.rect(9, 3, 1, 2, v.hair)
  // 轮廓
  P.hline(4, 8, 1, ink)
  P.vline(3, 2, 6, ink)
  P.vline(9, 2, 6, ink)
  // 身体（上衣）
  P.rect(3, 7, 7, 6, v.tunic)
  P.vline(3, 7, 12, v.tunicDark)
  P.vline(9, 7, 12, v.tunicDark)
  P.hline(3, 9, 12, v.tunicDark)
  // 手臂
  P.set(2, 8, v.tunicDark)
  P.set(10, 8, v.tunicDark)
  P.set(2, 9, C.skin)
  P.set(10, 9, C.skin)
  // 裤腿：两帧交替迈步
  if (f === 0) {
    P.rect(4, 13, 2, 3, ink)
    P.rect(7, 13, 2, 3, ink)
  } else {
    P.rect(3, 13, 2, 3, ink)
    P.rect(8, 13, 2, 3, ink)
  }
  // 外轮廓收拾
  P.hline(3, 9, 7, v.tunicDark)
}

function hex2(s) {
  const n = parseInt(s.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** 软发光盘 48x48：径向衰减白色，运行时 tint + additive */
export function makeGlow() {
  const p = new Px(48, 48)
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      const dx = x - 23.5
      const dy = y - 23.5
      const d = Math.sqrt(dx * dx + dy * dy) / 23.5
      const a = Math.max(0, 1 - d)
      p.set(x, y, [255, 255, 255], Math.round(Math.pow(a, 2.2) * 255))
    }
  }
  return p
}

/** 烟雾团 9x9 */
export function makeSmoke() {
  const p = new Px(9, 9)
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 9; x++) {
      const dx = x - 4
      const dy = y - 4
      const d = Math.sqrt(dx * dx + dy * dy) / 4.5
      const a = Math.max(0, 1 - d)
      p.set(x, y, C.smoke, Math.round(Math.pow(a, 1.6) * 190))
    }
  }
  return p
}

/** 脚底椭圆影 14x6 */
export function makeShadow() {
  const p = new Px(14, 6)
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 14; x++) {
      const dx = (x - 6.5) / 7
      const dy = (y - 2.5) / 3
      const d = dx * dx + dy * dy
      if (d <= 1) p.set(x, y, [10, 6, 4], Math.round((1 - d) * 110 + 20))
    }
  }
  return p
}

/** 全屏暗角：中心透明 → 边缘暗（尺寸可参数化，web 端用 384x216 拉伸铺屏） */
export function makeVignette(w = 384, h = 216) {
  const W = w
  const H = h
  const p = new Px(W, H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / (W / 2)
      const dy = (y - H / 2) / (H / 2)
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy))
      const a = Math.pow(Math.max(0, d - 0.45) / 0.55, 1.7)
      if (a > 0) p.set(x, y, [8, 5, 3], Math.round(a * 165))
    }
  }
  return p
}
