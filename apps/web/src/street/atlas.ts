import { Assets, Rectangle, Texture } from 'pixi.js'
import { FRAMES } from '@burnless/sprites/atlas-data'
import atlasPngUrl from '@burnless/sprites/atlas.png'

export type FrameName = keyof typeof FRAMES & string

let source: Texture['source'] | null = null
const cache = new Map<string, Texture>()

/** 加载图集（幂等），nearest 采样保像素锐利 */
export async function loadAtlas(): Promise<void> {
  if (source) return
  const tex = await Assets.load(atlasPngUrl)
  tex.source.scaleMode = 'nearest'
  source = tex.source
}

/** 取帧纹理（带缓存；同一帧复用同一 Texture 实例） */
export function frame(name: FrameName): Texture {
  const hit = cache.get(name)
  if (hit) return hit
  if (!source) throw new Error('atlas not loaded — call loadAtlas() first')
  const f = FRAMES[name]
  const tex = new Texture({ source, frame: new Rectangle(f.x, f.y, f.w, f.h) })
  cache.set(name, tex)
  return tex
}
