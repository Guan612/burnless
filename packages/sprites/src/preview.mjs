// pnpm preview —— 星露谷式 3/4 俯视街景预览（决策 #20）。1x 渲染 240x135 后 2x 放大输出。
// 布局常量与 apps/web/src/street/scene.ts 保持一致（改布局两边同步）。
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Px, mulberry32 } from './lib.mjs'
import { C, STALL_VARIANTS, NPC_VARIANTS } from './palette.mjs'
import { makeGlow, makeSmoke, makeVignette } from './painters.mjs'
import { ATLAS, frame } from './atlas-cache.mjs'

const TILE = 16
const COLS = 15
const W = COLS * TILE // 240
const H = 160
const canvas = new Px(W, H)

// --- 天空：分带渐变（阶梯过渡）+ 剪影楼 ---
const bands = [C.night1, C.night2, C.night3, C.night4]
const horizon = 84
bands.forEach((c, i) => {
  const y0 = Math.floor((horizon / bands.length) * i)
  const y1 = Math.floor((horizon / bands.length) * (i + 1))
  canvas.rect(0, y0, W, y1 - y0, c)
})
const rng = mulberry32(7)
for (let i = 0; i < 6; i++) {
  const bw = 28 + Math.floor(rng() * 34)
  const bh = 16 + Math.floor(rng() * 40)
  const bx = Math.floor(rng() * (W - bw))
  const by = horizon - bh
  canvas.rect(bx, by, bw, bh, C.silhouette)
  for (let wy = by + 3; wy < by + bh - 3; wy += 4) {
    for (let wx = bx + 3; wx < bx + bw - 3; wx += 4) {
      if (rng() < 0.3) canvas.rect(wx, wy, 1, 1, C.window, 200)
    }
  }
}

// --- 地面：上人行道 68-84 / 马路 84-116 / 下人行道 116-160 ---
const GROUND_Y = 68
for (let row = 0; row < 6; row++) {
  for (let col = 0; col < COLS; col++) {
    const y = GROUND_Y + row * TILE // 68..164，画布裁到 160
    const name = y < 84 ? 'ground/walk' : y < 116 ? 'ground/road' : 'ground/walk'
    canvas.composite(ATLAS.crop(frame(name)), col * TILE, y)
  }
}
// 马路中线磨损虚线
for (let x0 = 0; x0 < W; x0 += 32) {
  canvas.rect(x0 + 6, 99, 10, 2, C.roadDash, 180)
}

// --- 三摊位摆上人行道南缘（脚踩 y=84 线）+ 灯柱 ---
const stalls = [
  { x: 12, variant: 0 },
  { x: 88, variant: 1 },
  { x: 164, variant: 2 },
]
const poles = [60, 136] // 摊位间隙
const glow = makeGlow()

for (const px of poles) {
  canvas.composite(ATLAS.crop(frame('prop/pole')), px, 84 - 44)
  canvas.additive(glow, px + 4 - 24, 84 - 44 + 8 - 24, [255, 150, 90])
}
for (const st of stalls) {
  canvas.composite(ATLAS.crop(frame(`stall/${STALL_VARIANTS[st.variant].name}`)), st.x, 84 - 74)
  // 灯笼（精灵内 (60,17)）与炭火（(33,39)）
  canvas.additive(glow, st.x + 60 - 24, 84 - 74 + 17 - 24, [255, 140, 80])
  canvas.additive(glow, st.x + 33 - 24, 84 - 74 + 39 - 24, [255, 120, 50])
}

// --- 顾客：上排 1 人 + 马路/下排过路 6 人（星露谷式 y 排序：脚越低越靠前） ---
const npcs = [
  { x: 30, y: 80, v: 1, f: 0 },
  { x: 76, y: 104, v: 0, f: 0 },
  { x: 52, y: 126, v: 2, f: 1 },
  { x: 104, y: 110, v: 1, f: 1 },
  { x: 148, y: 130, v: 3, f: 0 },
  { x: 190, y: 122, v: 2, f: 1 },
  { x: 214, y: 148, v: 3, f: 0 },
]
for (const n of npcs) {
  canvas.composite(ATLAS.crop(frame('fx/shadow')), n.x - 7, n.y - 3)
  canvas.composite(ATLAS.crop(frame(`npc/${NPC_VARIANTS[n.v].name}/${n.f}`)), n.x - 6, n.y - 17)
}

// --- 炊烟（摊顶上方） ---
const smoke = makeSmoke()
for (const st of stalls) {
  canvas.composite(smoke, st.x + 28, 84 - 74 - 8)
  canvas.composite(smoke, st.x + 34, 84 - 74 - 16)
}

// --- 暗角（按预览尺寸生成）+ 2x 放大输出 ---
canvas.composite(makeVignette(W, H), 0, 0)
const out = canvas.scaleUp(2)
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'generated')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'preview.png'), out.toPngBuffer())
console.log(`preview -> generated/preview.png (${out.w}x${out.h})`)
