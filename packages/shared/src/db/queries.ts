/**
 * DB 适配接口 + SQL 常量（决策 #13 缝 #2：全部 SQL 收进本模块，面向接口编写）。
 * D1 与 better-sqlite3 各一份薄执行器共用这里的 SQL 与迁移文件；
 * 路由层禁止散写 c.env.DB.prepare。
 * SQL 用 sqlite 方言（D1 = sqlite，better-sqlite3 = sqlite，天然一致）。
 */

export interface PlayerRow {
  id: string
  name: string
  rating: number
  matches: number
  createdAt: number
  lastSeenAt: number
}

export interface ResultRecord {
  playerId: string
  matchId: string
  score: number
  revenue: number
  reputation: number
  gradeKey: string
  ratingAfter: number
  seasonId: number
}

export interface DbAdapter {
  /** 玩家不存在则建档（游客名可后续在档案页改） */
  ensurePlayer(playerId: string, name?: string): Promise<PlayerRow>
  getPlayer(playerId: string): Promise<PlayerRow | null>
  /** 记一局结果 + 段位/场次一并推进 */
  recordResult(r: ResultRecord): Promise<void>
  /** 排位榜（按段位分） */
  topPlayers(limit: number): Promise<PlayerRow[]>
  /** 解锁：返回本次新解锁的 item id（收藏 toast 用） */
  unlockByScore(playerId: string, score: number): Promise<string[]>
  unlocks(playerId: string): Promise<string[]>
  /** 账号升级过户（W8 邮箱注册）：游客的档案/对局历史/收藏整体迁到正式账号名下。
   *  目标已有档案则保留其自身段位，只并入历史与收藏；源档案迁空后删除 */
  migratePlayer(fromId: string, toId: string, name?: string): Promise<void>
  /** 当前赛季 id（首访惰性建档：赛季 1） */
  activeSeasonId(nowMs: number): Promise<number>
  /** 赛季滚动（Cron 调）：超 28 天则结档开新季并软重置段位，返回新季 id */
  rolloverSeasonIfDue(nowMs: number): Promise<number | null>
}

export const SQL = {
  ensurePlayer: /* sql */ `
    INSERT INTO players (id, name, rating, matches, created_at, last_seen_at)
    VALUES (?, COALESCE(?, '摊主' || substr(?, 1, 4)), 500, 0, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = COALESCE(excluded.name, players.name),
      last_seen_at = excluded.last_seen_at
    RETURNING id, name, rating, matches, created_at AS createdAt, last_seen_at AS lastSeenAt`,
  getPlayer: /* sql */ `
    SELECT id, name, rating, matches, created_at AS createdAt, last_seen_at AS lastSeenAt
    FROM players WHERE id = ?`,
  recordResult: /* sql */ `
    INSERT INTO match_results (player_id, match_id, score, revenue, reputation, grade_key, rating_after, season_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  bumpRating: /* sql */ `
    UPDATE players SET rating = ?, matches = matches + 1, last_seen_at = ? WHERE id = ?`,
  topPlayers: /* sql */ `
    SELECT id, name, rating, matches, created_at AS createdAt, last_seen_at AS lastSeenAt
    FROM players WHERE matches > 0 ORDER BY rating DESC LIMIT ?`,
  unlocks: /* sql */ `
    SELECT item_id AS itemId FROM unlocks WHERE player_id = ?`,
  unlockItem: /* sql */ `
    INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at) VALUES (?, ?, ?)`,
  // —— 账号升级过户（migratePlayer 五步；顺序敏感：先建档再迁子表最后删源） ——
  migratePlayerTarget: /* sql */ `
    INSERT INTO players (id, name, rating, matches, created_at, last_seen_at)
    SELECT ?, name, rating, matches, created_at, last_seen_at FROM players WHERE id = ?
    ON CONFLICT(id) DO NOTHING`,
  migratePlayerResults: /* sql */ `
    UPDATE match_results SET player_id = ? WHERE player_id = ?`,
  migratePlayerUnlocks: /* sql */ `
    INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at)
    SELECT ?, item_id, unlocked_at FROM unlocks WHERE player_id = ?`,
  /* 复制不删源（去重合并语义），源收藏行要单独清，否则源档删不掉 */
  migratePlayerUnlocksDrop: /* sql */ `
    DELETE FROM unlocks WHERE player_id = ?`,
  migratePlayerDrop: /* sql */ `
    DELETE FROM players WHERE id = ?`,
  migratePlayerRename: /* sql */ `
    UPDATE players SET name = COALESCE(?, name), last_seen_at = ? WHERE id = ?`,
  activeSeason: /* sql */ `
    SELECT id, started_at AS startedAt FROM seasons WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1`,
  openSeason: /* sql */ `
    INSERT INTO seasons (started_at) VALUES (?)`,
  closeSeason: /* sql */ `
    UPDATE seasons SET ended_at = ? WHERE id = ? AND ended_at IS NULL`,
  softResetRatings: /* sql */ `
    UPDATE players SET rating = 500 + CAST((rating - 500) * 0.5 AS INTEGER)`,
} as const
