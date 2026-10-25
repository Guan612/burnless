import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, CircleCheck, Maximize, RotateCw, Share2, Volume2, VolumeX, X } from 'lucide-react'
import { GamePanels } from '../game/GamePanels'
import type { UseMatchRoomResult } from '../game/useMatchRoom'
import { sfx } from '../game/sfx'
import { shareInvite } from '../game/share'
import { initStreet, type StreetHandle, type StreetMatchState } from './scene'

/** 烧心值配色（与 GamePanels HUD 同语义） */
function heartburnColor(v: number): string {
  if (v >= 70) return 'var(--bad)'
  if (v >= 40) return 'var(--accent)'
  return 'var(--ok)'
}

/** 本地 TS DOM lib 未收录 orientation.lock（Chrome/Android 已实现），收窄补上 */
type LockableOrientation = ScreenOrientation & { lock?: (orientation: 'landscape') => Promise<void> }

/** 全屏切换：手机横屏打匹配时的高频诉求；进全屏后尝试锁横屏（Android 支持，iOS/桌面静默失败），退出时解锁 */
function toggleFullscreen(): void {
  if (document.fullscreenElement) {
    screen.orientation?.unlock?.()
    void document.exitFullscreen().catch(() => {})
  } else {
    void document.documentElement
      .requestFullscreen?.()
      .then(() => (screen.orientation as LockableOrientation | null)?.lock?.('landscape'))
      .catch(() => {})
  }
}

/** 街道页渲染：PixiJS 场景 + 游戏面板。对局状态由路由层（routes/index）注入 */
export function StreetTab(props: { game: UseMatchRoomResult }) {
  const { game } = props
  const navigate = useNavigate()
  const hostRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<StreetHandle | null>(null)
  const matchStateRef = useRef<StreetMatchState | null>(null)
  const [fps, setFps] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState(sfx.isMuted)
  const [shared, setShared] = useState(false)
  /** 点中的摊位：index + 摊身中心的屏幕坐标（详情卡贴摊弹出，跟 toast/HUD 各走各的路） */
  const [inspect, setInspect] = useState<{ index: number; x: number; y: number; hw: number } | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let local: StreetHandle | null = null
    initStreet(host, setFps, (i, at) => {
      // 点摊位看摊内情况：再点同一个摊收起
      sfx.play('ui_tick')
      setInspect((cur) => (cur && cur.index === i ? null : { index: i, ...at }))
    })
      .then((h) => {
        if (disposed) h.destroy()
        else {
          local = h
          handleRef.current = h
          h.setMatch(matchStateRef.current) // 场景就绪晚于首帧快照：补灌当前对局数据
        }
      })
      .catch((e) => setError(String(e)))
    return () => {
      disposed = true
      local?.destroy()
      handleRef.current = null
    }
  }, [])

  // 对局数据进场景：摊位名牌 + 台面前排队人数（快照 1Hz 一拍，intents 即时帧顺带刷新）
  useEffect(() => {
    const snap = game.snap
    const state: StreetMatchState | null = snap
      ? {
          stalls: snap.stalls.map((s) => ({
            name: s.name,
            ownerName: s.ownerName ?? null,
            isPlayer: s.isPlayer,
            human: s.human,
            queueLen: s.queueLen,
            closedForS: s.closedForS,
          })),
        }
      : null
    matchStateRef.current = state
    handleRef.current?.setMatch(state)
  }, [game.snap])

  const share = () => {
    void shareInvite(game.matchId).then((r) => {
      if (r === 'shared' || r === 'copied') {
        setShared(true)
        sfx.play('ui_confirm')
        window.setTimeout(() => setShared(false), 1600)
      }
    })
  }

  return (
    <div className="street-wrap">
      <div ref={hostRef} className="street-host" />
      <span className="fps-badge">{fps > 0 ? `${fps} FPS` : '…'}</span>
      {/* 对局专属的竖屏引导：大厅/排行/收藏等页不渲染，竖屏直接可用 */}
      <div className="rotate-overlay" aria-hidden>
        <span className="rotate-icon"><RotateCw size={44} strokeWidth={1.6} /></span>
        <p className="rotate-title">请横屏游玩</p>
        <p className="dim">把手机转过来，夜市在横向的街道上</p>
      </div>
      {/* 矮横屏（手机）的悬浮快捷条：页头隐藏后从这里返回/分享/全屏/静音 */}
      <div className="street-quick">
        <Link to="/" className="quick-btn" aria-label="返回大厅">
          <ArrowLeft size={15} />
        </Link>
        <button className="quick-btn" onClick={share} aria-label="分享邀请链接">
          {shared ? <CircleCheck size={15} /> : <Share2 size={15} />}
        </button>
        <button className="quick-btn" onClick={toggleFullscreen} aria-label="全屏">
          <Maximize size={15} />
        </button>
        <button
          className={`quick-btn${muted ? ' off' : ''}`}
          onClick={() => setMuted(sfx.toggle())}
          aria-label={muted ? '开启音效' : '静音'}
        >
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
      </div>
      {error && <div className="street-error">渲染失败：{error}</div>}
      {/* 点摊位弹出的摊内详情：贴着摊位侧边弹（左半场摊弹右、右半场弹左），垂直对齐摊身并夹在视口内 */}
      {inspect !== null && game.snap?.stalls[inspect.index] && (
        (() => {
          const s = game.snap.stalls[inspect.index]!
          const host = hostRef.current
          const PW = 176
          const PH = 168
          let left = inspect.x
          let top = inspect.y
          if (host) {
            left = inspect.x <= host.clientWidth / 2 ? inspect.x + inspect.hw + 8 : inspect.x - inspect.hw - 8 - PW
            left = Math.min(Math.max(8, left), host.clientWidth - PW - 8)
            top = Math.min(Math.max(8, inspect.y - PH / 2), Math.max(8, host.clientHeight - PH - 8))
          }
          return (
            <div className="stall-inspect pe" style={{ left, top }}>
              <div className="si-head">
                <b>{s.name}</b>
                <button className="si-close" onClick={() => setInspect(null)} aria-label="关闭">
                  <X size={13} />
                </button>
              </div>
              <div className="si-row"><span>老板</span><b>{s.ownerName ?? (s.human ? '—' : 'bot 代打')}</b></div>
              <div className="si-row"><span>售价</span><b>¥{s.price}/串</b></div>
              <div className="si-row"><span>口碑</span><b>{s.reputation}</b></div>
              <div className="si-row"><span>排队</span><b>{s.queueLen} 人</b></div>
              <div className="si-row">
                <span>烧心值</span>
                <b style={{ color: heartburnColor(s.heartburn) }}>{s.heartburn}</b>
              </div>
              <div className="si-row"><span>状态</span><b>{s.closedForS > 0 ? `停业 ${s.closedForS}s` : game.snap.phase === 'waiting' ? '准备开张' : '营业中'}</b></div>
            </div>
          )
        })()
      )}
      <GamePanels
        snap={game.snap}
        toasts={game.toasts}
        send={game.send}
        restart={game.restart}
        matchId={game.matchId}
        status={game.status}
        isHost={game.isHost}
        onStart={game.startMatch}
        onCancel={() => void navigate({ to: '/' })}
      />
    </div>
  )
}
