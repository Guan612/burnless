import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COLLECTION } from '../src/db/collection'
import { SQL, type DbAdapter, type PlayerRow, type ResultRecord } from '../src/db/queries'
import { RATING_BASE, SEASON_LENGTH_MS, nextRating } from '../src/db/rating'

/**
 * 决策 #13 缝 #2 的证明：同一个 DbAdapter 接口、同一份 SQL 常量、同一份迁移文件，
 * 在 better-sqlite3（Node 逃生舱）上跑通——D1 适配器（apps/worker/src/db/d1.ts）只是换个执行器。
 * 迁移文件不在 shared 包内，跨包读取仅测试用。
 */
const MIGRATION = readFileSync(join(__dirname, '../../../apps/worker/migrations/0001_w6_init.sql'), 'utf8')

function createNodeAdapter(db: Database.Database): DbAdapter {
  const get = <T>(sql: string, ...params: unknown[]): T | undefined => db.prepare(sql).get(...(params as never[])) as T | undefined
  const all = <T>(sql: string, ...params: unknown[]): T[] => db.prepare(sql).all(...(params as never[])) as T[]
  const run = (sql: string, ...params: unknown[]): { changes: number } =>
    db.prepare(sql).run(...(params as never[])) as unknown as { changes: number }

  const unlockByScore = (playerId: string, score: number): string[] => {
    const now = Date.now()
    const newly: string[] = []
    for (const item of COLLECTION) {
      if (item.unlockScore > score) continue
      const r = run(SQL.unlockItem, playerId, item.id, now)
      if (r.changes > 0) newly.push(item.id)
    }
    return newly
  }

  return {
    ensurePlayer(playerId, name) {
      const now = Date.now()
      const row = get<PlayerRow>(SQL.ensurePlayer, playerId, name ?? null, playerId, now, now)
      if (!row) throw new Error('ensurePlayer failed')
      return row
    },
    async getPlayer(playerId) {
      return get<PlayerRow>(SQL.getPlayer, playerId) ?? null
    },
    async recordResult(r: ResultRecord) {
      run(SQL.recordResult, r.playerId, r.matchId, r.score, r.revenue, r.reputation, r.gradeKey, r.ratingAfter, r.seasonId, Date.now())
      run(SQL.bumpRating, r.ratingAfter, Date.now(), r.playerId)
      unlockByScore(r.playerId, r.score)
    },
    async topPlayers(limit) {
      return all<PlayerRow>(SQL.topPlayers, limit)
    },
    async unlockByScore(playerId, score) {
      return unlockByScore(playerId, score)
    },
    async unlocks(playerId) {
      return all<{ itemId: string }>(SQL.unlocks, playerId).map((r) => r.itemId)
    },
    async migratePlayer(fromId, toId, name) {
      run(SQL.migratePlayerTarget, toId, fromId)
      run(SQL.migratePlayerResults, toId, fromId)
      run(SQL.migratePlayerUnlocks, toId, fromId)
      run(SQL.migratePlayerUnlocksDrop, fromId)
      run(SQL.migratePlayerDrop, fromId)
      if (name) run(SQL.migratePlayerRename, name, Date.now(), toId)
    },
    async activeSeasonId(nowMs) {
      const row = get<{ id: number }>(SQL.activeSeason)
      if (row) return row.id
      run(SQL.openSeason, nowMs)
      return get<{ id: number }>(SQL.activeSeason)!.id
    },
    async rolloverSeasonIfDue(nowMs) {
      const row = get<{ id: number; startedAt: number }>(SQL.activeSeason)
      if (!row || nowMs - row.startedAt < SEASON_LENGTH_MS) return null
      run(SQL.closeSeason, nowMs, row.id)
      run(SQL.softResetRatings)
      run(SQL.openSeason, nowMs)
      return get<{ id: number }>(SQL.activeSeason)!.id
    },
  }
}

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(MIGRATION)
  return db
}

describe('DbAdapter（#13 缝：better-sqlite3 + 同一份 SQL/迁移）', () => {
  it('建档幂等：ensurePlayer 二次调用不重复、名字可更新', async () => {
    const adapter = createNodeAdapter(freshDb())
    const a = await adapter.ensurePlayer('u1', '老张8888')
    const b = await adapter.ensurePlayer('u1')
    expect(a.id).toBe('u1')
    expect(b.id).toBe('u1')
    expect(b.rating).toBe(RATING_BASE)
  })

  it('结算落库：段位推进 + 榜单排序 + 场次累计', async () => {
    const db = freshDb()
    const adapter = createNodeAdapter(db)
    const seasonId = await adapter.activeSeasonId(Date.now())
    const a = await adapter.ensurePlayer('ua', '高分手')
    const b = await adapter.ensurePlayer('ub', '低分手')

    const rec = (p: PlayerRow, score: number): ResultRecord => ({
      playerId: p.id,
      matchId: 'm-test',
      score,
      revenue: score,
      reputation: 50,
      gradeKey: 'game.grade.veteran',
      ratingAfter: nextRating(p.rating, score),
      seasonId,
    })
    await adapter.recordResult(rec(a, 1200))
    await adapter.recordResult(rec(a, 1000))
    await adapter.recordResult(rec(b, 600))

    const top = await adapter.topPlayers(10)
    expect(top.map((p) => p.id)).toEqual(['ua', 'ub'])
    expect(top[0]!.matches).toBe(2)
    expect(top[0]!.rating).toBeGreaterThan(RATING_BASE)
  })

  it('收藏解锁：达阈值解锁且幂等，未达阈值不解锁', async () => {
    const adapter = createNodeAdapter(freshDb())
    await adapter.ensurePlayer('uc', '收藏家')
    const first = await adapter.unlockByScore('uc', 950)
    expect(first).toEqual(['street-lantern', 'secret-sauce'])
    const again = await adapter.unlockByScore('uc', 950)
    expect(again).toEqual([])
    expect((await adapter.unlocks('uc')).sort()).toEqual(['secret-sauce', 'street-lantern'])
  })

  it('赛季滚动：28 天到期结档开新季，段位软重置；未到期不动', async () => {
    const adapter = createNodeAdapter(freshDb())
    const now = Date.now()
    const seasonId = await adapter.activeSeasonId(now)
    const p = await adapter.ensurePlayer('ud', '要重置的')
    await adapter.recordResult({
      playerId: p.id, matchId: 'm-s', score: 1500, revenue: 1500, reputation: 80,
      gradeKey: 'game.grade.master', ratingAfter: nextRating(p.rating, 1500), seasonId,
    })
    const high = (await adapter.getPlayer('ud'))!.rating
    expect(await adapter.rolloverSeasonIfDue(now + SEASON_LENGTH_MS - 1000)).toBeNull()
    const newSeason = await adapter.rolloverSeasonIfDue(now + SEASON_LENGTH_MS + 1000)
    expect(newSeason).toBe(seasonId + 1)
    const after = (await adapter.getPlayer('ud'))!.rating
    expect(after).toBeLessThan(high)
    expect(after).toBeGreaterThan(RATING_BASE - 1)
  })

  it('账号过户：游客档案/对局/收藏整体迁到正式号，源档清空；目标已有档案则保留其段位', async () => {
    const db = freshDb()
    const adapter = createNodeAdapter(db)
    const seasonId = await adapter.activeSeasonId(Date.now())
    const guest = await adapter.ensurePlayer('guest', '游客老王')
    await adapter.recordResult({
      playerId: guest.id, matchId: 'm-1', score: 900, revenue: 900, reputation: 40,
      gradeKey: 'game.grade.veteran', ratingAfter: 620, seasonId,
    })
    await adapter.unlockByScore('guest', 900)

    // 正式号已有档案（此前在本浏览器玩过）→ 冲突分支：保留目标段位，只并入历史/收藏
    await adapter.ensurePlayer('real', '正式号')

    await adapter.migratePlayer('guest', 'real', '新摊主名')
    const merged = (await adapter.getPlayer('real'))!
    expect(merged.name).toBe('新摊主名')
    expect(merged.rating).toBe(RATING_BASE) // 目标自身段位不被游客的 620 覆盖
    expect(merged.matches).toBe(0) // matches 是结算累计，历史行的并入不动它
    expect(await adapter.getPlayer('guest')).toBeNull()
    expect((await adapter.unlocks('real')).sort()).toEqual(['secret-sauce', 'street-lantern'])
    const results = db.prepare(`SELECT player_id FROM match_results WHERE match_id = 'm-1'`).all() as Array<{ player_id: string }>
    expect(results.map((r) => r.player_id)).toEqual(['real'])
  })
})
