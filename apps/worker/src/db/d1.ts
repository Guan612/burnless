import { COLLECTION, SEASON_LENGTH_MS, SQL, type DbAdapter, type PlayerRow, type ResultRecord } from '@burnless/shared'

/**
 * DbAdapter 的 D1 实现（决策 #13 缝 #2）：SQL 全部来自 shared 的 SQL 常量，
 * 这里只做绑定与执行。Node 逃生舱（better-sqlite3）实现同一接口复用同一份 SQL。
 */

type Row = Record<string, unknown>

function asPlayer(row: Row): PlayerRow {
  return {
    id: String(row.id),
    name: String(row.name),
    rating: Number(row.rating),
    matches: Number(row.matches),
    createdAt: Number(row.createdAt),
    lastSeenAt: Number(row.lastSeenAt),
  }
}

export function createD1Adapter(db: D1Database): DbAdapter {
  const run = async (sql: string, ...params: unknown[]): Promise<D1Result> => db.prepare(sql).bind(...params).run()
  const one = async (sql: string, ...params: unknown[]): Promise<Row | null> => {
    const r = await db.prepare(sql).bind(...params).first<Row>()
    return r ?? null
  }
  const rows = async (sql: string, ...params: unknown[]): Promise<Row[]> => {
    const r = await db.prepare(sql).bind(...params).all<Row>()
    return r.results ?? []
  }

  return {
    async ensurePlayer(playerId, name) {
      const now = Date.now()
      const row = await one(SQL.ensurePlayer, playerId, name ?? null, playerId, now, now)
      if (!row) throw new Error('ensurePlayer failed')
      return asPlayer(row)
    },

    async getPlayer(playerId) {
      const row = await one(SQL.getPlayer, playerId)
      return row ? asPlayer(row) : null
    },

    async recordResult(r: ResultRecord) {
      const now = Date.now()
      await run(SQL.recordResult, r.playerId, r.matchId, r.score, r.revenue, r.reputation, r.gradeKey, r.ratingAfter, r.seasonId, now)
      await run(SQL.bumpRating, r.ratingAfter, now, r.playerId)
      // 顺带检查收藏解锁（单局分达阈值）
      await this.unlockByScore(r.playerId, r.score)
    },

    async topPlayers(limit) {
      const rs = await rows(SQL.topPlayers, limit)
      return rs.map(asPlayer)
    },

    async unlockByScore(playerId, score) {
      // 目录以 shared 的 COLLECTION 为准；INSERT OR IGNORE 的 changes>0 即本次新解锁
      const now = Date.now()
      const newly: string[] = []
      for (const item of COLLECTION) {
        if (item.unlockScore > score) continue
        const r = await run(SQL.unlockItem, playerId, item.id, now)
        if ((r.meta?.changes ?? 0) > 0) newly.push(item.id)
      }
      return newly
    },

    async unlocks(playerId) {
      const rs = await rows(SQL.unlocks, playerId)
      return rs.map((r) => String(r.itemId))
    },

    async migratePlayer(fromId, toId, name) {
      // D1 batch = 一个事务：过户要么整体成功要么不动（防半迁状态）
      await db.batch([
        db.prepare(SQL.migratePlayerTarget).bind(toId, fromId),
        db.prepare(SQL.migratePlayerResults).bind(toId, fromId),
        db.prepare(SQL.migratePlayerUnlocks).bind(toId, fromId),
        db.prepare(SQL.migratePlayerUnlocksDrop).bind(fromId),
        db.prepare(SQL.migratePlayerDrop).bind(fromId),
      ])
      if (name) await run(SQL.migratePlayerRename, name, Date.now(), toId)
    },

    async activeSeasonId(nowMs) {
      const row = await one(SQL.activeSeason)
      if (row) return Number(row.id)
      await run(SQL.openSeason, nowMs)
      const created = await one(SQL.activeSeason)
      if (!created) throw new Error('openSeason failed')
      return Number(created.id)
    },

    async rolloverSeasonIfDue(nowMs) {
      const row = await one(SQL.activeSeason)
      if (!row) return null
      const startedAt = Number(row.startedAt)
      if (nowMs - startedAt < SEASON_LENGTH_MS) return null
      const seasonId = Number(row.id)
      await run(SQL.closeSeason, nowMs, seasonId)
      await run(SQL.softResetRatings)
      await run(SQL.openSeason, nowMs)
      const created = await one(SQL.activeSeason)
      return created ? Number(created.id) : null
    },
  }
}
