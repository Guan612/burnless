#!/usr/bin/env node
// 对局房冒烟测试：匿名登录 → hello 入座 → intent 改价即时回快照 → 断线重连续座（W4 验收的脚本化最小集）。
// 用法：node scripts/smoke-match.mjs [port]（需 wrangler dev 运行中；Node >= 22，用内置 WebSocket）
// 对局房要求有效会话（防伪造身份落库污染段位），脚本先 POST /api/auth/sign-in/anonymous 拿 cookie。

const port = process.argv[2] ?? '8787'
const base = `http://localhost:${port}`
const MATCH = `smoke-${Math.random().toString(36).slice(2, 8)}`
const url = `ws://localhost:${port}/ws/match/${MATCH}`

const fail = (msg) => {
  console.error('FAIL:', msg)
  process.exit(1)
}
const ok = (msg) => console.log('OK:', msg)

// 1) 匿名登录拿会话 cookie（set-cookie 可能有多个属性段，取整段原样回带）
const login = await fetch(`${base}/api/auth/sign-in/anonymous`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
})
if (!login.ok) fail(`匿名登录失败: ${login.status}（wrangler dev 是否在运行？）`)
const setCookie = login.headers.get('set-cookie') ?? ''
const cookie = setCookie.split(';')[0]
if (!cookie) fail('登录响应里没有 set-cookie')
ok(`匿名登录成功（${cookie.slice(0, 24)}…）`)

const guard = setTimeout(() => fail('15s 内未完成对局房冒烟'), 15_000)

let seatToken = null
let seatId = null
let priced = false

const ws = new WebSocket(url, { headers: { cookie } })

ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ type: 'hello', player: { id: 'forged-id-should-be-ignored' } }))
})

ws.addEventListener('message', (ev) => {
  let msg
  try {
    msg = JSON.parse(String(ev.data))
  } catch {
    return fail(`非 JSON 帧: ${String(ev.data).slice(0, 100)}`)
  }
  if (msg.type === 'match_welcome') {
    if (msg.spectating || !msg.seatId) return fail('预期拿到座位，实际观战')
    seatToken = msg.seatToken
    seatId = msg.seatId
    // 等待房先作为房主提前开局（waiting 期 intent 会被模拟层静默拒绝），开局后再改价
    if (msg.snap.phase === 'waiting') {
      if (!msg.host) return fail('首入座者应为房主，才能提前开局')
      ws.send(JSON.stringify({ type: 'start' }))
      return
    }
    ws.send(JSON.stringify({ type: 'intent', intent: { kind: 'price', value: 8 } }))
    return
  }
  if (msg.type === 'snap') {
    if (msg.snap.phase === 'waiting') return // 等 start 生效
    if (!priced && msg.snap.price !== 8) {
      // 首个 running 快照：现在改价（房主 start 后 phase 翻转的那拍）
      priced = true
      ws.send(JSON.stringify({ type: 'intent', intent: { kind: 'price', value: 8 } }))
      return
    }
    if (msg.snap.price === 8) {
      ok(`intent 改价生效（${seatId} → ¥${msg.snap.price}），接下来测重连续座`)
      ws.close()
      reconnect()
    }
    return
  }
  if (msg.type === 'error') return fail(`服务器报错: ${msg.message}`)
})

ws.addEventListener('error', () => fail('WebSocket 连接失败（wrangler dev 是否在运行？）'))

function reconnect() {
  const ws2 = new WebSocket(url, { headers: { cookie } })
  ws2.addEventListener('open', () => {
    ws2.send(JSON.stringify({ type: 'resume', token: seatToken }))
  })
  ws2.addEventListener('message', (ev) => {
    let msg
    try {
      msg = JSON.parse(String(ev.data))
    } catch {
      return
    }
    if (msg.type === 'match_welcome') {
      if (msg.seatId !== seatId) return fail(`续座失败：期望 ${seatId}，实际 ${msg.seatId}`)
      if (msg.snap.price !== 8) return fail(`续座后状态丢失：期望 ¥8，实际 ${msg.snap.price}`)
      clearTimeout(guard)
      ok(`resume 续座成功：回到 ${msg.seatId}，改价 ¥${msg.snap.price} 原样保留`)
      ws2.close()
      process.exit(0)
    }
  })
  ws2.addEventListener('error', () => fail('重连失败'))
}
