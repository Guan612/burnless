#!/usr/bin/env node
// 回声房冒烟测试：连接 /ws/room/smoke，发送 echo，断言服务器广播回来。
// 用法：node scripts/smoke-ws.mjs [port]（需 wrangler dev 运行中；Node >= 22，用内置 WebSocket）

const port = process.argv[2] ?? '8787'
const url = `ws://localhost:${port}/ws/room/smoke`
const TEXT = 'hello-burnless'

const ws = new WebSocket(url)
let protocol = '?'

const fail = (msg) => {
  console.error('FAIL:', msg)
  process.exit(1)
}

const timeout = setTimeout(() => fail('10s 内未收到 echo'), 10_000)

ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ type: 'echo', text: TEXT }))
})

ws.addEventListener('message', (ev) => {
  let msg
  try {
    msg = JSON.parse(String(ev.data))
  } catch {
    return fail(`非 JSON 帧: ${String(ev.data).slice(0, 100)}`)
  }
  if (msg.type === 'welcome') {
    protocol = msg.protocol ?? '?'
    return
  }
  if (msg.type === 'echo' && msg.text === TEXT) {
    clearTimeout(timeout)
    console.log(`OK: echo 往返成功，seq=${msg.seq}，协议 v${protocol}`)
    ws.close()
    process.exit(0)
  }
  fail(`意外消息: ${JSON.stringify(msg)}`)
})

ws.addEventListener('error', () => fail('WebSocket 连接失败（wrangler dev 是否在运行？）'))
