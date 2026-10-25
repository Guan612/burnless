// 图集缓存：preview.mjs 专用（mjs 不能直接 import 生成的 .ts，读 JSON 同源数据）。
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import { Px } from './lib.mjs'

const png = PNG.sync.read(readFileSync(new URL('../generated/atlas.png', import.meta.url)))
const px = new Px(png.width, png.height)
px.data.set(png.data)

const frames = JSON.parse(readFileSync(new URL('../generated/atlas-data.json', import.meta.url), 'utf8'))

export function frame(name) {
  const f = frames[name]
  if (!f) throw new Error(`unknown frame: ${name}`)
  return f
}

export const ATLAS = {
  crop(f) {
    const p = new Px(f.w, f.h)
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const [r, g, b, a] = px.get(f.x + x, f.y + y)
        p.set(x, y, [r, g, b], a)
      }
    }
    return p
  },
}
