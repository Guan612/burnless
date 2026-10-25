/**
 * 段位规则（决策 #6：轻 meta，无数值膨胀）。
 * 段位分 = 旧分 60% + 本局综合分 40%——赢在当下但不至于一局封神。
 * 档位命名沿用游戏梗味评级（大排档学徒 → 不烧心大师）。
 */

export const RATING_BASE = 500

export type GradeKey =
  | 'game.grade.apprentice'
  | 'game.grade.veteran'
  | 'game.grade.rising'
  | 'game.grade.master'

export function nextRating(current: number, score: number): number {
  return Math.round(current * 0.6 + score * 0.4)
}

export function gradeForRating(rating: number): GradeKey {
  if (rating < 600) return 'game.grade.apprentice'
  if (rating < 1000) return 'game.grade.veteran'
  if (rating < 1500) return 'game.grade.rising'
  return 'game.grade.master'
}

/** 赛季软重置：新季从 (500 + (旧分−500)×0.5) 起步，高段位有记忆、低段位回炉 */
export function seasonResetRating(rating: number): number {
  return Math.round(RATING_BASE + (rating - RATING_BASE) * 0.5)
}

/** 赛季时长（W6 决定：MVP 固定 4 周一季，Cron 日检滚动） */
export const SEASON_LENGTH_MS = 28 * 24 * 60 * 60 * 1000
