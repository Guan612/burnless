import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { COLLECTION, SEASON_LENGTH_MS, SQL, type DbAdapter, type PlayerRow, type ResultRecord } from '@burnless/shared'

/**
 * DbAdapter 的 better-sqlite3 实现（决策 #13 缝 #2 的另一半）：
 * SQL 全部来自 shared 的 SQL 常量，与 D1 执行器共用同一份迁移文件。
 */

type Row = Record<string, unknown>

export function openDatabase(dbPath: string): Database.Database {
  mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  return db
}

/** 迁移文件与 worker 共用（apps/worker/migrations）：源码运行（tsx）、打包运行（dist）、仓库根三种基准都找一遍 */
function findMigrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.resolve(here, '../../worker/migrations'), // 打包后 dist/server.mjs
    path.resolve(here, '../../../worker/migrations'), // tsx 直跑 src/db/
    path.resolve('apps/worker/migrations'), // cwd = 仓库根
  ].filter((p): p is string => Boolean(p))
  for (const c of candidates) {
    try {
      if (readdirSync(c).some((f) => f.endsWith('.sql'))) return c
    } catch {
      // 试下一个基准
    }
  }
  throw new Error(`找不到迁移目录（apps/worker/migrations），可用 MIGRATIONS_DIR 指定；试过：${candidates.join(', ')}`)
}

/**
 * 幂等迁移：0001 全 IF NOT EXISTS 可重放；0002 起含 ALTER TABLE（SQLite 不支持条件 ADD COLUMN），
 * 故用 _migrations 执行账本记账——已应用的文件跳过。D1 侧由 wrangler d1 migrations 同语义托管。
 */
export function migrate(db: Database.Database): void {
  const dir = findMigrationsDir()
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (file TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`)
  const applied = new Set(
    (db.prepare(`SELECT file FROM _migrations`).all() as Array<{ file: string }>).map((r) => r.file),
  )
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue
    db.exec(readFileSync(path.join(dir, file), 'utf8'))
    db.prepare(`INSERT INTO _migrations (file, applied_at) VALUES (?, ?)`).run(file, Date.now())
  }
}

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

export function createSqliteAdapter(db: Database.Database): DbAdapter {
  const run = (sql: string, ...params: unknown[]): { changes: number } => db.prepare(sql).run(...params) as { changes: number }
  const one = (sql: string, ...params: unknown[]): Row | null => (db.prepare(sql).get(...params) as Row | undefined) ?? null
  const rows = (sql: string, ...params: unknown[]): Row[] => db.prepare(sql).all(...params) as Row[]

  return {
    async ensurePlayer(playerId, name) {
      const now = Date.now()
      const row = one(SQL.ensurePlayer, playerId, name ?? null, playerId, now, now)
      if (!row) throw new Error('ensurePlayer failed')
      return asPlayer(row)
    },

    async getPlayer(playerId) {
      const row = one(SQL.getPlayer, playerId)
      return row ? asPlayer(row) : null
    },

    async recordResult(r: ResultRecord) {
      const now = Date.now()
      run(SQL.recordResult, r.playerId, r.matchId, r.score, r.revenue, r.reputation, r.gradeKey, r.ratingAfter, r.seasonId, now)
      run(SQL.bumpRating, r.ratingAfter, now, r.playerId)
      // 顺带检查收藏解锁（单局分达阈值）
      await this.unlockByScore(r.playerId, r.score)
    },

    async topPlayers(limit) {
      return rows(SQL.topPlayers, limit).map(asPlayer)
    },

    async unlockByScore(playerId, score) {
      const now = Date.now()
      const newly: string[] = []
      for (const item of COLLECTION) {
        if (item.unlockScore > score) continue
        const r = run(SQL.unlockItem, playerId, item.id, now)
        if (r.changes > 0) newly.push(item.id)
      }
      return newly
    },

    async unlocks(playerId) {
      return rows(SQL.unlocks, playerId).map((r) => String(r.itemId))
    },

    async migratePlayer(fromId, toId, name) {
      const tx = db.transaction(() => {
        run(SQL.migratePlayerTarget, toId, fromId)
        run(SQL.migratePlayerResults, toId, fromId)
        run(SQL.migratePlayerUnlocks, toId, fromId)
        run(SQL.migratePlayerUnlocksDrop, fromId)
        run(SQL.migratePlayerDrop, fromId)
        if (name) run(SQL.migratePlayerRename, name, Date.now(), toId)
      })
      tx()
    },

    async activeSeasonId(nowMs) {
      const row = one(SQL.activeSeason)
      if (row) return Number(row.id)
      run(SQL.openSeason, nowMs)
      const created = one(SQL.activeSeason)
      if (!created) throw new Error('openSeason failed')
      return Number(created.id)
    },

    async rolloverSeasonIfDue(nowMs) {
      const row = one(SQL.activeSeason)
      if (!row) return null
      const startedAt = Number(row.startedAt)
      if (nowMs - startedAt < SEASON_LENGTH_MS) return null
      const seasonId = Number(row.id)
      run(SQL.closeSeason, nowMs, seasonId)
      run(SQL.softResetRatings)
      run(SQL.openSeason, nowMs)
      const created = one(SQL.activeSeason)
      return created ? Number(created.id) : null
    },
  }
}
