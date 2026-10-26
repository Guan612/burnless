import { Hono } from 'hono'
import { PROTOCOL_VERSION, type Healthz } from '@burnless/shared'
import { createAuth, listLinkedProviders } from './auth'
import { createD1Adapter } from './db/d1'
import { MatchMaker } from './matchmaker'
import { MatchRoom } from './room'

const app = new Hono<{ Bindings: Env }>()

function clientIp(c: { req: { header(name: string): string | undefined } }): string {
  return c.req.header('cf-connecting-ip') ?? 'local'
}

/**
 * WS 升级频控（isolate 级滑动窗口，30 次/分钟/IP）：拦无脑连接风暴最外层。
 * Workers 多 isolate 各持一份计数，不保证精确——对局房另有「必须有会话」的硬门禁兜底，
 * 回声房仅测试用途，此层够用。DO 里还有 MatchMaker 的权威 per-IP 限流。
 */
const WS_UPGRADE_MAX = 30
const WS_UPGRADE_WINDOW_MS = 60_000
const wsUpgrades = new Map<string, number[]>()

function wsUpgradeAllowed(ip: string): boolean {
  const now = Date.now()
  const hits = (wsUpgrades.get(ip) ?? []).filter((t) => now - t < WS_UPGRADE_WINDOW_MS)
  if (hits.length >= WS_UPGRADE_MAX) {
    wsUpgrades.set(ip, hits)
    return false
  }
  hits.push(now)
  wsUpgrades.set(ip, hits)
  if (wsUpgrades.size > 10_000) {
    for (const [k, v] of wsUpgrades) {
      if (v.every((t) => now - t >= WS_UPGRADE_WINDOW_MS)) wsUpgrades.delete(k)
    }
  }
  return true
}

app.get('/api/healthz', (c) => {
  const body: Healthz = { ok: true, protocol: PROTOCOL_VERSION, ts: Date.now() }
  return c.json(body)
})

// ===== 身份（决策 #19：better-auth 匿名起步） =====
app.on(['POST', 'GET'], '/api/auth/*', (c) => createAuth(c.env).handler(c.req.raw))

/** 当前玩家档案：匿名会话 → 档位/段位/收藏；未登录返回 user:null */
app.get('/api/me', async (c) => {
  const auth = createAuth(c.env)
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session?.user) return c.json({ user: null })
  const db = createD1Adapter(c.env.DB)
  // better-auth 匿名用户默认名是 "Anonymous"，换成市井味默认名
  const name = session.user.name && session.user.name !== 'Anonymous' ? session.user.name : undefined
  const player = await db.ensurePlayer(session.user.id, name)
  return c.json({
    user: { id: player.id, name: player.name, email: session.user.email || null },
    // 匿名游客标记（页头账号入口据此区分「游客升级」与「已登录」）
    anonymous: session.user.isAnonymous === true,
    rating: player.rating,
    matches: player.matches,
    unlocks: await db.unlocks(player.id),
    // W7 账号升级：providers=服务端配置了哪些 OAuth（能力位），linked=本人已绑定的 provider
    providers: { github: Boolean(c.env.GITHUB_CLIENT_ID && c.env.GITHUB_CLIENT_SECRET) },
    linked: await listLinkedProviders(c.env, session.user.id),
  })
})

// ===== 排位榜 =====
app.get('/api/rank', async (c) => {
  const db = createD1Adapter(c.env.DB)
  return c.json({ players: await db.topPlayers(20) })
})

// ===== 匹配（MatchMaker DO 单例，RPC 直调） =====
app.post('/api/match/quick', async (c) => {
  const auth = createAuth(c.env)
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  const playerId = session?.user.id ?? crypto.randomUUID()
  const maker = c.env.MATCH_MAKER.getByName('global')
  try {
    return c.json(await maker.quickMatch(playerId, clientIp(c)))
  } catch (err) {
    if (err instanceof Error && err.message === 'RATE_LIMITED') return c.text('too many requests', 429)
    throw err
  }
})

app.post('/api/match/private', async (c) => {
  const maker = c.env.MATCH_MAKER.getByName('global')
  try {
    return c.json(await maker.createPrivate(clientIp(c)))
  } catch (err) {
    if (err instanceof Error && err.message === 'RATE_LIMITED') return c.text('too many requests', 429)
    throw err
  }
})

// WebSocket 升级原样转发给房间 DO：回声房（W1 链路验证）与对局房（W4 服务器权威）
// 都由 MatchRoom 承载，DO 内按路径分流到 RoomActor / MatchActor
app.get('/ws/room/:roomId', (c) => {
  const roomId = c.req.param('roomId')
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(roomId)) return c.text('invalid room id', 400)
  if (!wsUpgradeAllowed(clientIp(c))) return c.text('too many connections', 429)
  return c.env.MATCH_ROOM.getByName(roomId).fetch(c.req.raw)
})

app.get('/ws/match/:matchId', async (c) => {
  const matchId = c.req.param('matchId')
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(matchId)) return c.text('invalid match id', 400)
  if (!wsUpgradeAllowed(clientIp(c))) return c.text('too many connections', 429)
  // 对局必须持有效会话（匿名也算）：结算落库认会话 id，客户端 hello 自报的 id 不再被信任。
  // 会话 cookie 随同源 WS 握手自动带上；SameSite=Lax 下跨站网页拿不到 cookie，天然挡住劫流
  const auth = createAuth(c.env)
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session?.user) return c.text('session required', 401)
  // 内部信任头一律覆盖后转发：客户端自带同名头无法伪造（DO 不可直连，只此一条进路）
  const headers = new Headers(c.req.raw.headers)
  headers.set('x-verified-player-id', session.user.id)
  return c.env.MATCH_ROOM.getByName(matchId).fetch(new Request(c.req.raw, { headers }))
})

// 其余路径交给静态资源（SPA fallback 由 assets 的 not_found_handling 处理）
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default {
  fetch: app.fetch,
  /** 赛季滚动（Cron 日检，28 天到期结档 + 段位软重置） */
  scheduled: (event, env, ctx) => {
    ctx.waitUntil(
      createD1Adapter(env.DB)
        .rolloverSeasonIfDue(Date.now())
        .then((newId) => {
          if (newId !== null) console.log('[burnless] season rolled over →', newId)
        })
        .catch((err) => console.error('[burnless] season rollover failed:', err)),
    )
  },
} satisfies ExportedHandler<Env>

export { MatchRoom, MatchMaker }
export type AppType = typeof app
