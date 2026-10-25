/**
 * 收集目录（决策 #6：纯外观，不带局内数值）。
 * 解锁条件：单局综合分达到阈值；落库在 unlocks 表，客户端收藏页展示。
 */
export interface CollectItem {
  id: string
  nameKey: string
  descKey: string
  /** 单局综合分达到即解锁 */
  unlockScore: number
}

export const COLLECTION: CollectItem[] = [
  { id: 'street-lantern', nameKey: 'collect.item.lantern.name', descKey: 'collect.item.lantern.desc', unlockScore: 700 },
  { id: 'secret-sauce', nameKey: 'collect.item.sauce.name', descKey: 'collect.item.sauce.desc', unlockScore: 900 },
  { id: 'golden-grill', nameKey: 'collect.item.grill.name', descKey: 'collect.item.grill.desc', unlockScore: 1200 },
  { id: 'burnless-apron', nameKey: 'collect.item.apron.name', descKey: 'collect.item.apron.desc', unlockScore: 1500 },
]
