// 本文件由 `pnpm sprites` 自动生成 —— 请勿手改；改 src/painters.mjs 后重新生成。
export const ATLAS_SIZE = { width: 512, height: 512 } as const

export interface AtlasFrame {
  x: number
  y: number
  w: number
  h: number
}

export const FRAMES = {
  "fx/vignette": {
    "x": 0,
    "y": 0,
    "w": 384,
    "h": 216
  },
  "stall/red": {
    "x": 385,
    "y": 0,
    "w": 64,
    "h": 78
  },
  "stall/teal": {
    "x": 0,
    "y": 217,
    "w": 64,
    "h": 78
  },
  "stall/gold": {
    "x": 65,
    "y": 217,
    "w": 64,
    "h": 78
  },
  "fx/glow": {
    "x": 130,
    "y": 217,
    "w": 48,
    "h": 48
  },
  "prop/pole": {
    "x": 179,
    "y": 217,
    "w": 8,
    "h": 44
  },
  "npc/red/0": {
    "x": 188,
    "y": 217,
    "w": 12,
    "h": 17
  },
  "npc/red/1": {
    "x": 201,
    "y": 217,
    "w": 12,
    "h": 17
  },
  "npc/teal/0": {
    "x": 214,
    "y": 217,
    "w": 12,
    "h": 17
  },
  "npc/teal/1": {
    "x": 227,
    "y": 217,
    "w": 12,
    "h": 17
  },
  "npc/gold/0": {
    "x": 240,
    "y": 217,
    "w": 12,
    "h": 17
  },
  "npc/gold/1": {
    "x": 253,
    "y": 217,
    "w": 12,
    "h": 17
  },
  "npc/plum/0": {
    "x": 266,
    "y": 217,
    "w": 12,
    "h": 17
  },
  "npc/plum/1": {
    "x": 279,
    "y": 217,
    "w": 12,
    "h": 17
  },
  "ground/road": {
    "x": 292,
    "y": 217,
    "w": 16,
    "h": 16
  },
  "ground/walk": {
    "x": 309,
    "y": 217,
    "w": 16,
    "h": 16
  },
  "fx/smoke": {
    "x": 326,
    "y": 217,
    "w": 9,
    "h": 9
  },
  "fx/shadow": {
    "x": 336,
    "y": 217,
    "w": 14,
    "h": 6
  }
} as const satisfies Record<string, AtlasFrame>
