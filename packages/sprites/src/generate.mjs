// pnpm sprites —— 生成图集 + 色板/帧位常量。产物提交进仓库，改画笔后重跑即可。
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Atlas } from './lib.mjs'
import { STALL_VARIANTS, NPC_VARIANTS } from './palette.mjs'
import {
  drawRoadTile,
  drawWalkTile,
  drawStall,
  drawNpc,
  drawPole,
  makeGlow,
  makeSmoke,
  makeShadow,
  makeVignette,
} from './painters.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'generated')
mkdirSync(outDir, { recursive: true })

const atlas = new Atlas(512)

// 大块优先 shelf 打包
atlas.add('fx/vignette', 384, 216, (P) => P.composite(makeVignette()))
for (const v of STALL_VARIANTS) {
  atlas.add(`stall/${v.name}`, 64, 78, (P) => drawStall(P, v))
}
atlas.add('fx/glow', 48, 48, (P) => P.composite(makeGlow()))
atlas.add('prop/pole', 8, 44, (P) => drawPole(P))
for (const v of NPC_VARIANTS) {
  for (const f of [0, 1]) {
    atlas.add(`npc/${v.name}/${f}`, 12, 17, (P) => drawNpc(P, v, f))
  }
}
atlas.add('ground/road', 16, 16, (P) => drawRoadTile(P))
atlas.add('ground/walk', 16, 16, (P) => drawWalkTile(P))
atlas.add('fx/smoke', 9, 9, (P) => P.composite(makeSmoke()))
atlas.add('fx/shadow', 14, 6, (P) => P.composite(makeShadow()))

writeFileSync(join(outDir, 'atlas.png'), atlas.canvas.toPngBuffer())
writeFileSync(join(outDir, 'atlas-data.json'), JSON.stringify(atlas.frames))

const ts = `// 本文件由 \`pnpm sprites\` 自动生成 —— 请勿手改；改 src/painters.mjs 后重新生成。
export const ATLAS_SIZE = { width: ${atlas.size}, height: ${atlas.size} } as const

export interface AtlasFrame {
  x: number
  y: number
  w: number
  h: number
}

export const FRAMES = ${JSON.stringify(atlas.frames, null, 2)} as const satisfies Record<string, AtlasFrame>
`
writeFileSync(join(outDir, 'atlas-data.ts'), ts)

console.log(`atlas: ${Object.keys(atlas.frames).length} frames -> generated/atlas.png + atlas-data.ts`)
