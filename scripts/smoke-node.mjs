#!/usr/bin/env node
// Node 逃生舱冒烟：构建 → 临时库起服务 → healthz / WS 回声 / 快速匹配 REST / 对局入座。
// 用法：node scripts/smoke-node.mjs（自带服务生命周期与临时目录清理，无需预先启动）

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PORT = 8800 + Math.floor(Math.random() * 100)
const BASE = `http://127.0.0.1:${PORT}`
const tmp = mkdtempSync(path.join(tmpdir(), 'burnless-node-smoke-'))
let server = null

const fail = (msg) => {
  console.error('FAIL:', msg)
  cleanup(1)
}
const ok = (msg) => console.log(`  ✓ ${msg}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function cleanup(code) {
  try {
    server?.kill()
  } catch {}
  try {
    rmSync(tmp, { recursive: true, force: true })
  } catch {}
  process.exit(code)
}

const run = async () => {
  console.log('[smoke-node] 构建 server-node…')
  await new Promise((resolve, reject) => {
    const p = spawn('pnpm', ['--filter', '@burnless/server-node', 'build'], { stdio: 'inherit', shell: true })
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`build exit ${c}`))))
  })

  console.log(`[smoke-node] 启动 :${PORT}（临时库 ${tmp}）`)
  server = spawn(process.execPath, ['dist/server.mjs'], {
    cwd: 'apps/server-node',
    env: {
      ...process.env,
      PORT: String(PORT),
      BURNLESS_DB: path.join(tmp, 'burnless.sqlite'),
      BETTER_AUTH_SECRET: 'smoke-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`))
  server.on('exit', (c) => {
    if (c !== 0 && c !== null) fail(`server 意外退出 code=${c}`)
  })

  // 1) healthz
  let health = null
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/healthz`)
      if (r.ok) {
        health = await r.json()
        break
      }
    } catch {}
    await sleep(500)
  }
  if (!health?.ok) fail('healthz 未通过')
  ok(`healthz ok（protocol ${health.protocol}）`)

  // 2) WS 回声房
  const wsEcho = new WebSocket(`${BASE.replace('http', 'ws')}/ws/room/smoke-node`)
  const echoResult = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('echo 10s 超时')), 10_000)
    wsEcho.addEventListener('open', () => wsEcho.send(JSON.stringify({ type: 'echo', text: 'burnless-node-smoke' })))
    wsEcho.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data))
      if (msg.type === 'echo' && msg.text === 'burnless-node-smoke') {
        clearTimeout(t)
        resolve(true)
      }
    })
  })
  wsEcho.close()
  if (!echoResult) fail('回声未返回')
  ok('回声房 roundtrip 通过')

  // 3) 快速匹配 REST
  const res = await fetch(`${BASE}/api/match/quick`, { method: 'POST' })
  const match = await res.json()
  if (!res.ok || !match.matchId) fail(`quick match 失败: ${res.status}`)
  ok(`快速匹配 → ${match.matchId}（queued=${match.queued}）`)

  // 4) 对局房入座（对局房要求会话，先匿名登录拿 cookie）
  const login = await fetch(`${BASE}/api/auth/sign-in/anonymous`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  if (!login.ok) fail(`匿名登录失败: ${login.status}`)
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  if (!cookie) fail('登录响应里没有 set-cookie')
  const wsMatch = new WebSocket(`${BASE.replace('http', 'ws')}/ws/match/${match.matchId}`, {
    headers: { cookie },
  })
  const joined = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('match_welcome 10s 超时')), 10_000)
    wsMatch.addEventListener('open', () => wsMatch.send(JSON.stringify({ type: 'hello', player: { id: 'smoke-player' } })))
    wsMatch.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data))
      if (msg.type === 'match_welcome') {
        clearTimeout(t)
        resolve(msg)
      }
    })
  })
  wsMatch.close()
  if (joined.spectating || !joined.seatId) fail('未正常入座')
  ok(`对局入座 ${joined.seatId}（协议 ${joined.protocol}，快照 v${joined.snap.version}）`)

  console.log('[smoke-node] 全部通过 ✅')
  cleanup(0)
}

run().catch((e) => fail(e.message))
