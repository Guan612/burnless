import { useEffect, useRef, useState } from 'react'
import { createT, type ServerMessage } from '@burnless/shared'
import { EchoSocket, type WsStatus } from './ws-client'

const t = createT('zh-CN')
const ROOM_ID = 'lobby'

/** W1 回声房验收页（保留作链路测试入口） */
export function EchoTab() {
  const [status, setStatus] = useState<WsStatus>('connecting')
  const [log, setLog] = useState<ServerMessage[]>([])
  const [draft, setDraft] = useState('')
  const [myId, setMyId] = useState('')
  const socketRef = useRef<EchoSocket | null>(null)

  useEffect(() => {
    const socket = new EchoSocket()
    socketRef.current = socket
    socket.connect(ROOM_ID, {
      onStatus: setStatus,
      onMessage: (msg) => {
        if (msg.type === 'welcome') {
          setMyId(msg.you)
          setLog(msg.history.map((e) => ({ type: 'echo', ...e })))
          return
        }
        setLog((prev) => [...prev, msg])
      },
    })
    return () => socket.close()
  }, [])

  const send = () => {
    const text = draft.trim()
    if (text && socketRef.current?.send({ type: 'echo', text })) setDraft('')
  }

  const statusLabel: Record<WsStatus, string> = {
    connecting: t('web.echo.connecting'),
    open: t('web.echo.connected'),
    closed: t('web.echo.disconnected'),
  }

  return (
    <div className="echo-wrap">
      <section className="panel">
        <div className="panel-head">
          <h2>{t('web.echo.title')}</h2>
          <span className="room">
            {t('web.echo.room', { room: ROOM_ID })} · {statusLabel[status]}
          </span>
        </div>

        <ul className="log">
          {log.length === 0 && <li className="dim">{t('web.echo.empty')}</li>}
          {log.map((msg, i) => {
            if (msg.type === 'echo') {
              return (
                <li key={`e-${msg.seq}-${i}`}>
                  <b>{msg.from === myId ? t('web.echo.you') : msg.from.slice(0, 8)}</b>：{msg.text}
                </li>
              )
            }
            if (msg.type === 'joined') {
              return (
                <li key={`j-${i}`} className="dim">
                  {t('web.log.joined', { id: msg.id.slice(0, 8) })}
                </li>
              )
            }
            if (msg.type === 'left') {
              return (
                <li key={`l-${i}`} className="dim">
                  {t('web.log.left', { id: msg.id.slice(0, 8) })}
                </li>
              )
            }
            if (msg.type === 'error') {
              return (
                <li key={`x-${i}`} className="err">
                  {t('web.log.error', { message: msg.message })}
                </li>
              )
            }
            return null
          })}
        </ul>

        <div className="row">
          <input
            value={draft}
            placeholder={t('web.echo.placeholder')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
          />
          <button onClick={send} disabled={status !== 'open'}>
            {t('web.echo.send')}
          </button>
        </div>
      </section>
    </div>
  )
}
