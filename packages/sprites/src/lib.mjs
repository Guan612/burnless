// 像素绘制引擎：调色板锁定的纯代码像素画（决策 #10）。
// PixelBuffer + 偏移画笔 + 图集 shelf 打包 + pngjs 编码，零原生依赖。
import { PNG } from 'pngjs'

export function hex(s) {
  const n = parseInt(s.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** 确定性 PRNG（mulberry32）：同一 seed 永远画出同一张图 */
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class Px {
  constructor(w, h) {
    this.w = w
    this.h = h
    this.data = new Uint8ClampedArray(w * h * 4)
  }

  set(x, y, c, a = 255) {
    x = Math.floor(x)
    y = Math.floor(y)
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const i = (y * this.w + x) * 4
    this.data[i] = c[0]
    this.data[i + 1] = c[1]
    this.data[i + 2] = c[2]
    this.data[i + 3] = a
  }

  get(x, y) {
    x = Math.floor(x)
    y = Math.floor(y)
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= this.w || y >= this.h) return [0, 0, 0, 0]
    const i = (y * this.w + x) * 4
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]]
  }

  rect(x, y, w, h, c, a = 255) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c, a)
  }

  hline(x1, x2, y, c, a = 255) {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) this.set(x, y, c, a)
  }

  vline(x, y1, y2, c, a = 255) {
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) this.set(x, y, c, a)
  }

  /** source-over 混合：把 src 贴到 (dx,dy) */
  composite(src, dx, dy) {
    dx = Math.floor(dx)
    dy = Math.floor(dy)
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const [r, g, b, a] = src.get(x, y)
        if (a === 0) continue
        const bx = dx + x
        const by = dy + y
        if (a === 255) {
          this.set(bx, by, [r, g, b], 255)
          continue
        }
        const [br, bg, bb, ba] = this.get(bx, by)
        const na = a / 255
        const oa = ba / 255
        const outA = na + oa * (1 - na)
        if (outA === 0) continue
        const mix = (f, t) => Math.round((f * na + t * oa * (1 - na)) / outA)
        this.set(bx, by, [mix(r, br), mix(g, bg), mix(b, bb)], Math.round(outA * 255))
      }
    }
  }

  /** 加法发光混合（预览用；PixiJS 运行时走真正的 additive blend） */
  additive(src, dx, dy, tint = [255, 255, 255]) {
    dx = Math.floor(dx)
    dy = Math.floor(dy)
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const [r, g, b, a] = src.get(x, y)
        if (a === 0) continue
        const bx = dx + x
        const by = dy + y
        const [br, bg, bb, ba] = this.get(bx, by)
        if (ba === 0) continue
        const k = (a / 255) * 0.9
        this.set(
          bx,
          by,
          [
            Math.min(255, br + (r * tint[0]) / 255 * k),
            Math.min(255, bg + (g * tint[1]) / 255 * k),
            Math.min(255, bb + (b * tint[2]) / 255 * k),
          ],
          ba,
        )
      }
    }
  }

  toPngBuffer() {
    const png = new PNG({ width: this.w, height: this.h })
    png.data = Buffer.from(this.data)
    return PNG.sync.write(png)
  }

  /** 最近邻整数放大（预览输出用；PixiJS 运行时靠 nearest scaleMode） */
  scaleUp(factor) {
    const out = new Px(this.w * factor, this.h * factor)
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const [r, g, b, a] = this.get(x, y)
        if (a === 0) continue
        out.rect(x * factor, y * factor, factor, factor, [r, g, b], a)
      }
    }
    return out
  }
}

/** 图集内偏移画笔：painter 拿到的坐标都是帧内局部坐标 */
export class Painter {
  constructor(px, ox, oy) {
    this.px = px
    this.ox = ox
    this.oy = oy
  }

  set(x, y, c, a = 255) {
    this.px.set(this.ox + x, this.oy + y, c, a)
  }

  rect(x, y, w, h, c, a = 255) {
    this.px.rect(this.ox + x, this.oy + y, w, h, c, a)
  }

  hline(x1, x2, y, c, a = 255) {
    this.px.hline(this.ox + x1, this.ox + x2, this.oy + y, c, a)
  }

  vline(x, y1, y2, c, a = 255) {
    this.px.vline(this.ox + x, this.oy + y1, this.oy + y2, c, a)
  }

  composite(src, x = 0, y = 0) {
    this.px.composite(src, this.ox + x, this.oy + y)
  }
}

/** shelf 打包：按加入顺序横向排，行高取该行最高帧 */
export class Atlas {
  constructor(size = 512) {
    this.size = size
    this.frames = {}
    this.canvas = new Px(size, size)
    this.cx = 0
    this.cy = 0
    this.rowH = 0
  }

  add(name, w, h, paint) {
    if (this.cx + w > this.size) {
      this.cx = 0
      this.cy += this.rowH
      this.rowH = 0
    }
    if (this.cy + h > this.size) throw new Error(`atlas overflow at ${name} (size ${this.size})`)
    const p = new Painter(this.canvas, this.cx, this.cy)
    paint(p)
    this.frames[name] = { x: this.cx, y: this.cy, w, h }
    this.cx += w + 1
    this.rowH = Math.max(this.rowH, h + 1)
    return this.frames[name]
  }
}
