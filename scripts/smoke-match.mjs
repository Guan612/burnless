#!/usr/bin/env node
// 对局房冒烟测试：hello 入座 → intent 改价即时回快照 → 断线重连续座（W4 验收的脚本化最小集）。
// 用法：node scripts/smoke-match.mjs [port]（需 wrangler dev 运行中；Node >= 22，用内置 WebSocket）

const port = process.argv[2] ?? '8787'
const MATCH = `smoke-${Math.random().toString(36).slice(2, 8)}`
const url = `ws://localhost:${port}/ws/match/${MATCH}`

const fail = (msg) => {
  console.error('FAIL:', msg)
  process.exit(1)
}
const ok = (msg) => console.log('OK:', msg)

const guard = setTimeout(() => fail('15s 内未完成对局房冒烟'), 15_000)

let seatToken = null
let seatId = null

const ws = new WebSocket(url)

ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ type: 'hello' }))
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
    ws.send(JSON.stringify({ type: 'intent', intent: { kind: 'price', value: 8 } }))
    return
  }
  if (msg.type === 'snap') {
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
  const ws2 = new WebSocket(url)
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
      if (msg.snap.price !== 8) return fail(`续座后状态丢失：期望 ¥8，实际 ¥${msg.snap.price}`)
      clearTimeout(guard)
      ok(`resume 续座成功：回到 ${msg.seatId}，改价 ¥${msg.snap.price} 原样保留`)
      ws2.close()
      process.exit(0)
    }
  })
  ws2.addEventListener('error', () => fail('重连失败'))
}
