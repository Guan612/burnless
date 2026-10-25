import { Hono } from 'hono'
import { PROTOCOL_VERSION, type Healthz } from '@burnless/shared'
import { createAuth, listLinkedProviders } from './auth'
import { createD1Adapter } from './db/d1'
import { MatchMaker } from './matchmaker'
import { MatchRoom } from './room'

const app = new Hono<{ Bindings: Env }>()

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
  return c.json(await maker.quickMatch(playerId))
})

app.post('/api/match/private', async (c) => {
  const maker = c.env.MATCH_MAKER.getByName('global')
  return c.json(await maker.createPrivate())
})

// WebSocket 升级原样转发给房间 DO：回声房（W1 链路验证）与对局房（W4 服务器权威）
// 都由 MatchRoom 承载，DO 内按路径分流到 RoomActor / MatchActor
app.get('/ws/room/:roomId', (c) => {
  const roomId = c.req.param('roomId')
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(roomId)) return c.text('invalid room id', 400)
  return c.env.MATCH_ROOM.getByName(roomId).fetch(c.req.raw)
})

app.get('/ws/match/:matchId', (c) => {
  const matchId = c.req.param('matchId')
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(matchId)) return c.text('invalid match id', 400)
  return c.env.MATCH_ROOM.getByName(matchId).fetch(c.req.raw)
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
