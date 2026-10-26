import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { PROTOCOL_VERSION, type Healthz } from '@burnless/shared'
import { WebSocketServer } from 'ws'
import { createAuth, listLinkedProviders } from './auth'
import { loadConfig } from './config'
import { NodeMatchMaker } from './matchmaker'
import { NodeRoom } from './rooms'
import { createSqliteAdapter, migrate, openDatabase } from './db/sqlite'

/**
 * 自部署逃生舱（决策 #13）：与 apps/worker 完全同构的 REST + WebSocket 服务，
 * 跑在 Node/Bun 上——Hono on Node + ws + better-sqlite3 + 同一份迁移文件。
 * 差异只有三处：静态资源本地目录、进程内房间 Map 代替 DO、系统 cron 代替 Cron Trigger。
 */

const cfg = loadConfig()
const db = openDatabase(cfg.dbPath)
migrate(db)

const auth = createAuth(db, cfg)
const maker = new NodeMatchMaker()

const app = new Hono()

app.get('/api/healthz', (c) => {
  const body: Healthz = { ok: true, protocol: PROTOCOL_VERSION, ts: Date.now() }
  return c.json(body)
})

app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw))

app.get('/api/me', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session?.user) return c.json({ user: null })
  const dba = createSqliteAdapter(db)
  const name = session.user.name && session.user.name !== 'Anonymous' ? session.user.name : undefined
  const player = await dba.ensurePlayer(session.user.id, name)
  return c.json({
    user: { id: player.id, name: player.name },
    rating: player.rating,
    matches: player.matches,
    unlocks: await dba.unlocks(player.id),
    providers: { github: Boolean(cfg.github) },
    linked: await listLinkedProviders(db, session.user.id),
  })
})

app.get('/api/rank', async (c) => {
  return c.json({ players: await createSqliteAdapter(db).topPlayers(20) })
})

app.post('/api/match/quick', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  const playerId = session?.user.id ?? crypto.randomUUID()
  return c.json(maker.quickMatch(playerId))
})

app.post('/api/match/private', (c) => c.json(maker.createPrivate()))

// 非 upgrade 的 /ws 请求与 DO 壳同款返回 426（真升级走 http server 的 upgrade 事件，不进这里）
app.get('/ws/*', (c) => c.text('expected websocket upgrade', 426))

// ---------- 静态资源 + SPA fallback（web 未构建时自动降级 API-only） ----------
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
}

if (cfg.assetsDir) {
  const assetsDir = cfg.assetsDir
  app.get('*', (c) => {
    const pathname = decodeURIComponent(new URL(c.req.raw.url).pathname)
    if (pathname.includes('..')) return c.text('bad path', 400)
    let file = path.join(assetsDir, pathname)
    try {
      if (statSync(file).isDirectory()) file = path.join(file, 'index.html')
    } catch {
      file = path.join(assetsDir, 'index.html') // SPA fallback（深路由回 index）
    }
    try {
      const body = readFileSync(file)
      return c.body(body, 200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' })
    } catch {
      return c.text('not found', 404)
    }
  })
  console.log(`[burnless-node] 静态资源：${assetsDir}`)
} else {
  console.warn('[burnless-node] 未找到 web 构建产物（../web/dist），以 API-only 模式启动')
}

// ---------- 房间注册表：进程内 Map 代替 DO（决策 #13 预案） ----------
const rooms = new Map<string, NodeRoom>()

function roomFor(pathname: string): NodeRoom {
  const roomId = pathname.split('/').pop() ?? 'unknown'
  let room = rooms.get(roomId)
  if (!room) {
    room = new NodeRoom({
      db,
      newToken: () => crypto.randomUUID(),
      onIdle: (r) => rooms.delete(roomId),
    })
    rooms.set(roomId, room)
  }
  return room
}

const WS_PATH = /^\/ws\/(room|match)\/[a-zA-Z0-9_-]{1,64}$/
const wss = new WebSocketServer({ noServer: true })

const server = serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`[burnless-node] 不烧心服务已就绪 → http://localhost:${info.port}（房间数 ${rooms.size}）`)
})

server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  if (!WS_PATH.test(url.pathname)) {
    socket.destroy()
    return
  }
  // 对局房与 worker 同款硬门禁：必须有会话（匿名也算），落库身份认会话 id（防伪造段位污染）
  if (url.pathname.startsWith('/ws/match/')) {
    let verified: { id: string } | null = null
    try {
      const session = await auth.api.getSession({ headers: new Headers(req.headers as Record<string, string>) })
      if (session?.user) verified = { id: session.user.id }
    } catch {
      // 无会话/坏 cookie：verified 保持 null（可玩不落库）
    }
    if (!verified) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => roomFor(url.pathname).connect(url, ws, verified))
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => roomFor(url.pathname).connect(url, ws))
})

// 赛季滚动：Node 侧用定时器代替 Cron Trigger（6h 检查一次，到期结档逻辑同款）
const rollover = setInterval(() => {
  createSqliteAdapter(db)
    .rolloverSeasonIfDue(Date.now())
    .then((newId) => {
      if (newId !== null) console.log('[burnless-node] season rolled over →', newId)
    })
    .catch((err) => console.error('[burnless-node] season rollover failed:', err))
}, 6 * 60 * 60 * 1000)
rollover.unref()

let closing = false
function shutdown(): void {
  if (closing) return
  closing = true
  console.log('[burnless-node] shutting down…')
  server.close()
  wss.close()
  db.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
