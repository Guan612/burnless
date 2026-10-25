// 全局色板：所有 sprite 只准从这里取色（决策 #10 的「共享色板常量」）。
// 夜市基调：暗夜空 + 暖木 + 烤火橙。改这里 = 全游戏换肤。
import { hex } from './lib.mjs'

export const C = {
  ink: hex('#241a12'),

  wood: hex('#7a4a2b'),
  woodLight: hex('#a06a3d'),
  woodDark: hex('#55331e'),

  canvas: hex('#f2e3c8'),

  red: hex('#d95d39'),
  redDark: hex('#a83e26'),
  teal: hex('#3f8f7b'),
  tealDark: hex('#2c6a5a'),
  gold: hex('#e8b04b'),
  goldDark: hex('#b57f2f'),
  plum: hex('#8f5f8f'),
  plumDark: hex('#6d4370'),

  ember: hex('#ff9d3b'),
  emberHot: hex('#ffd27a'),

  skin: hex('#e8b48c'),
  skinShade: hex('#c68d64'),

  road: hex('#524740'),
  roadLit: hex('#5d5048'),
  roadDark: hex('#453c35'),
  roadDash: hex('#6e6355'),

  walk: hex('#6b5a48'),
  walkLit: hex('#7d6a55'),
  walkDark: hex('#584a3b'),

  lantern: hex('#ff5c47'),
  lanternLight: hex('#ffb08a'),

  smoke: hex('#9a9188'),
  night1: hex('#191320'),
  night2: hex('#221a29'),
  night3: hex('#2d2130'),
  night4: hex('#3a2a35'),
  silhouette: hex('#120d15'),
  window: hex('#e8b04b'),

  hairBrown: hex('#4a2f1a'),
  hairGray: hex('#9a9188'),
  hairBlack: hex('#241a12'),
}

/** 摊位变体：主色 + 深色（遮阳棚条纹 / 招牌 / 灯笼） */
export const STALL_VARIANTS = [
  { name: 'red', main: C.red, dark: C.redDark },
  { name: 'teal', main: C.teal, dark: C.tealDark },
  { name: 'gold', main: C.gold, dark: C.goldDark },
]

/** 顾客变体：上衣 + 头发 */
export const NPC_VARIANTS = [
  { name: 'red', tunic: C.red, tunicDark: C.redDark, hair: C.hairBlack },
  { name: 'teal', tunic: C.teal, tunicDark: C.tealDark, hair: C.hairBrown },
  { name: 'gold', tunic: C.gold, tunicDark: C.goldDark, hair: C.hairGray },
  { name: 'plum', tunic: C.plum, tunicDark: C.plumDark, hair: C.hairBrown },
]
