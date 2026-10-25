import { BAL, createT, type Intent, type SimEvent, type SimSnapshot } from '@burnless/shared'
import {
  BadgeCheck,
  Banknote,
  Beef,
  Bot,
  CircleCheck,
  CircleX,
  Clock,
  DoorOpen,
  Flame,
  FlaskConical,
  Gavel,
  Heart,
  House,
  MessageSquareWarning,
  Moon,
  OctagonAlert,
  PackageCheck,
  PackageMinus,
  PackageX,
  Share2,
  ShieldCheck,
  Siren,
  Sprout,
  Star,
  ThumbsDown,
  TrendingUp,
  Truck,
  Trophy,
  User,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { sfx } from './sfx'
import { shareInvite } from './share'
import type { MatchStatus, Toast } from './useMatchRoom'

const t = createT('zh-CN')

function fmtTime(s: number): string {
  const m = Math.floor(Math.max(0, s) / 60)
  const ss = Math.max(0, s) % 60
  return `${m}:${String(ss).padStart(2, '0')}`
}

/** SimEvent.kind → 事件图标（toast 前缀；文案里的 emoji 已全部剥离） */
const EVENT_ICONS: Record<string, LucideIcon> = {
  restock_open: Truck,
  restock_done: PackageCheck,
  restock_skipped: PackageMinus,
  surge: Users,
  inspection_pass: BadgeCheck,
  inspection_fine: Siren,
  bad_review: ThumbsDown,
  loyal_return: Heart,
  stock_out: PackageX,
  self_verified: ShieldCheck,
  report_hit: Gavel,
  report_clean: CircleX,
  smear_done: MessageSquareWarning,
  smear_caught: OctagonAlert,
  ended: Moon,
}

function toastText(e: SimEvent): string {
  if (e.kind === 'bad_review') {
    const reason = t(`game.event.bad_review_reason.${e.vars?.reason ?? 'shady'}` as 'game.event.bad_review_reason.dalvy')
    return t('game.event.bad_review', { reason })
  }
  return t(('game.event.' + e.kind) as 'game.event.surge', e.vars)
}

function heartburnColor(v: number): string {
  if (v >= 70) return 'var(--bad)'
  if (v >= 40) return 'var(--accent)'
  return 'var(--ok)'
}

export function GamePanels(props: {
  snap: SimSnapshot | null
  toasts: Toast[]
  send: (i: Intent) => void
  restart: () => void
  matchId: string
  status: MatchStatus
  /** 等待期房主：可提前开局 */
  isHost: boolean
  /** 房主点开局（空位 bot 补位） */
  onStart: () => void
  /** 等待期取消：回大厅，等待房无人后服务器自动回收 */
  onCancel: () => void
}) {
  const { snap, toasts, send, restart, matchId, status, isHost, onStart, onCancel } = props
  const [share, setShare] = useState(0.5) // 进货滑杆：良心配比 0~1
  const [shared, setShared] = useState(false) // 邀请链接复制成功的按钮反馈
  const [skipped, setSkipped] = useState(false)

  const shareInviteLink = () => {
    void shareInvite(matchId).then((r) => {
      if (r === 'shared' || r === 'copied') {
        setShared(true)
        sfx.play('ui_confirm')
        window.setTimeout(() => setShared(false), 1600)
      }
    })
  }

  // 本轮窗口跳过后，下一轮窗口要恢复弹窗
  useEffect(() => {
    if (snap?.restockWindowLeftS === null) setSkipped(false)
  }, [snap?.restockWindowLeftS === null])

  if (!snap) return null

  // 与 sim.intent 的进货公式保持一致（数量、成本、良心/狠活拆分）
  const unitCost = BAL.costShady + (BAL.costHonest - BAL.costShady) * share
  const qty = Math.min(BAL.restockMax, Math.floor(snap.money / unitCost))
  const cost = Math.round(qty * unitCost * 100) / 100
  const honest = Math.round(qty * share)

  return (
    <div className="game-layer">
      {/* 左上 HUD */}
      <div className="hud">
        <span className="chip">
          <Wallet size={12} /> {t('game.hud.money')} ¥{snap.money}
        </span>
        <span className="chip">
          <Clock size={12} /> {t('game.hud.time')} {fmtTime(snap.durationS - snap.timeS)}
        </span>
        <span className="chip">
          <Star size={12} /> {t('game.hud.rep')} {snap.reputation}
        </span>
        <span className="chip" style={{ borderColor: heartburnColor(snap.heartburn), color: heartburnColor(snap.heartburn) }}>
          <Flame size={12} /> {t('game.hud.heartburn')} {snap.heartburn}
        </span>
        <span className="chip">
          <Beef size={12} /> {t('game.hud.stock')} {snap.stockHonest} / {snap.stockShady} · {t('game.hud.served', { n: snap.servedTotal })}
        </span>
        <span className="chip dim hud-room">
          <House size={12} /> {t('web.match.room', { matchId })}
          <i className={`dot ${status === 'open' ? 'ok' : 'warn'}`} aria-hidden />
        </span>
        <button
          className={`chip chip-btn${shared ? ' ok' : ''}`}
          onClick={shareInviteLink}
          title="复制/分享邀请链接"
        >
          {shared ? <CircleCheck size={12} /> : <Share2 size={12} />} {shared ? '已复制' : '邀请'}
        </button>
      </div>

      {/* 事件 toast：图标按事件类型配，文案已无 emoji */}
      <div className="toasts">
        {toasts.map((e) => {
          const Icon = EVENT_ICONS[e.kind]
          return (
            <div key={e.uid} className={`toast toast-${e.kind}`}>
              {Icon && <Icon size={13} aria-hidden />}
              <span>{toastText(e)}</span>
            </div>
          )
        })}
      </div>

      {/* 等待开局：发链接等朋友，人齐自动开局；房主可提前开局（空位 bot 补位） */}
      {snap.phase === 'waiting' && (
        <div className="modal-backdrop pe">
          <div className="modal">
            <h3>
              <DoorOpen size={15} /> {t('game.wait.title')}{' '}
              <span className="dim">{t('game.wait.countdown', { s: snap.waitingLeftS ?? 0 })}</span>
            </h3>
            <ul className="result-list">
              {snap.stalls.map((s) => (
                <li key={s.id}>
                  {s.human ? <User size={12} /> : <Bot size={12} />} {s.name}
                  <span className="dim">
                    {!s.human ? ` · ${t('game.wait.seat.empty')}` : s.isPlayer ? '（我）' : ''}
                  </span>
                </li>
              ))}
            </ul>
            <p className="dim">{t('game.wait.hint')}</p>
            <div className="modal-actions">
              <button className="ghost" onClick={shareInviteLink}>
                <Share2 size={13} /> {t('game.wait.invite')}
              </button>
              {isHost ? (
                <button
                  onClick={() => {
                    sfx.play('ui_confirm')
                    onStart()
                  }}
                >
                  {t('game.wait.start')}
                </button>
              ) : (
                <span className="dim">{t('game.wait.waiting')}</span>
              )}
              <button
                className="ghost"
                onClick={() => {
                  sfx.play('ui_tick')
                  onCancel()
                }}
              >
                {t('game.wait.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 底部操作条（开张后才有操作可做） */}
      {snap.phase === 'running' && (
        <div className="control-bar pe">
          <label className="price-ctl">
            <span>{t('game.control.price', { price: snap.price })}</span>
            <input
              type="range"
              min={4}
              max={12}
              step={0.5}
              value={snap.price}
              onChange={(e) => {
                sfx.play('ui_tick')
                send({ kind: 'price', value: Number(e.target.value) })
              }}
            />
          </label>
          <span className="chip">
            {/* 三态：窗口开着没下单（车在门口，倒计时关窗）｜已下单（不显示数字，等下一班）｜窗口没开（倒数班车到站） */}
            {snap.restockWindowLeftS !== null ? (
              snap.restockDone ? (
                <><PackageCheck size={12} /> {t('game.control.restocked')}</>
              ) : (
                <><Truck size={12} /> {t('game.control.truck_here', { s: snap.restockWindowLeftS })}</>
              )
            ) : (
              <><Truck size={12} /> {t('game.control.nextRestock', { s: snap.restockInS })}</>
            )}
          </span>
        </div>
      )}

      {/* 主动博弈动作条（W5）：自证清白 / 对手举报与刷差评 */}
      {snap.phase === 'running' && snap.stalls.some((s) => s.isPlayer) && (
        <div className="action-bar pe">
          <button
            className="ghost"
            disabled={snap.heartburn < BAL.verifyMinHeartburn || snap.money < BAL.verifyCost}
            onClick={() => {
              sfx.play('ui_confirm')
              send({ kind: 'verify' })
            }}
          >
            <ShieldCheck size={13} /> {t('game.action.verify', { cost: BAL.verifyCost })}
          </button>
          <span className="dim">{t('game.action.rivals')}：</span>
          {snap.stalls
            .filter((s) => !s.isPlayer)
            .map((s) => (
              <span key={s.id} className="rival-actions">
                <span className="dim">{s.name}</span>
                {/* 烧心值明牌：≥70 举报才会查实（颜色 <40 绿 / 40-69 黄 / ≥70 红） */}
                <span style={{ color: heartburnColor(s.heartburn), fontWeight: s.heartburn >= BAL.heartburnRiskAt ? 'bold' : undefined }}>
                  <Flame size={11} /> {Math.round(s.heartburn)}
                </span>
                <button
                  disabled={snap.reportCdLeftS > 0}
                  onClick={() => {
                    sfx.play('ui_confirm')
                    send({ kind: 'report', target: s.id })
                  }}
                >
                  {snap.reportCdLeftS > 0 ? (
                    `${snap.reportCdLeftS}s`
                  ) : (
                    <>
                      <Siren size={13} /> {t('game.action.report')}
                    </>
                  )}
                </button>
                <button
                  disabled={snap.smearCdLeftS > 0 || snap.money < BAL.smearCost}
                  onClick={() => {
                    sfx.play('ui_confirm')
                    send({ kind: 'smear', target: s.id })
                  }}
                >
                  {snap.smearCdLeftS > 0 ? (
                    `${snap.smearCdLeftS}s`
                  ) : (
                    <>
                      <MessageSquareWarning size={13} /> {t('game.action.smear')}
                    </>
                  )}
                </button>
              </span>
            ))}
        </div>
      )}

      {/* 进货决策弹窗（12s 窗口，可跳过等下一车；本班已下单则关闭） */}
      {snap.restockWindowLeftS !== null && !snap.restockDone && !skipped && snap.phase === 'running' && (
        <div className="modal-backdrop pe">
          <div className="modal">
            <h3>{t('game.restock.title')} <span className="dim">({snap.restockWindowLeftS}s)</span></h3>
            <p className="dim">{t('game.restock.timing', { every: BAL.restockEveryS, window: BAL.restockWindowS })}</p>
            <p className="dim">{t('game.restock.hint')}</p>
            <div className="restock-labels">
              <span><Sprout size={12} /> {t('game.restock.honest')}</span>
              <span><FlaskConical size={12} /> {t('game.restock.shady')}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={25}
              list="restock-scale"
              /* 左端=全良心、右端=全狠活：视觉方向与 honestShare 相反，value 做一次翻转 */
              value={Math.round((1 - share) * 100)}
              onChange={(e) => {
                sfx.play('ui_tick')
                setShare(1 - Number(e.target.value) / 100)
              }}
            />
            {/* 刻度标注：两端全良心/全狠活，中点半掺（默认停在中点） */}
            <div className="restock-scale" aria-hidden>
              <span>{t('game.restock.scale.honest')}</span>
              <span>{t('game.restock.scale.mid')}</span>
              <span>{t('game.restock.scale.shady')}</span>
            </div>
            <datalist id="restock-scale">
              <option value="0" />
              <option value="25" />
              <option value="50" />
              <option value="75" />
              <option value="100" />
            </datalist>
            <p className="restock-split">
              <Sprout size={11} /> {t('game.restock.honestCount', { n: honest })} · <FlaskConical size={11} /> {t('game.restock.shadyCount', { n: qty - honest })}
            </p>
            <p className="restock-cost">{t('game.restock.cost', { qty, cost })}</p>
            <div className="modal-actions">
              <button
                className="ghost"
                onClick={() => {
                  sfx.play('ui_tick')
                  setSkipped(true)
                }}
              >
                {t('game.restock.skip')}
              </button>
              <button
                disabled={qty <= 0}
                onClick={() => {
                  sfx.play('ui_confirm')
                  send({ kind: 'restock', honestShare: share })
                }}
              >
                {t('game.restock.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 局末结算 */}
      {snap.phase === 'ended' && snap.result && (
        <div className="modal-backdrop pe">
          <div className="modal">
            <h3>{t('game.result.title')} · {t(snap.result.gradeKey as 'game.grade.master')}</h3>
            <ul className="result-list">
              <li><Banknote size={12} /> {t('game.result.revenue')}：¥{snap.result.revenue}</li>
              <li><TrendingUp size={12} /> {t('game.result.profit')}：¥{snap.result.profit}</li>
              <li><Beef size={12} /> {t('game.result.served', { n: snap.result.served, honest: snap.result.honestServed, shady: snap.result.shadyServed })}</li>
              <li><Star size={12} /> {t('game.result.reputation')}：{snap.result.reputation}</li>
              {snap.result.fines > 0 && <li className="err"><OctagonAlert size={12} /> {t('game.result.fines')}：¥{snap.result.fines}</li>}
              {snap.result.rating && (
                <li className="score"><Trophy size={12} /> {t('game.result.rating', { old: snap.result.rating.old, after: snap.result.rating.after })}</li>
              )}
              <li className="score"><Trophy size={12} /> {t('game.result.score')}：<b>{snap.result.score}</b></li>
            </ul>
            <div className="modal-actions">
              <button
                onClick={() => {
                  sfx.play('ui_confirm')
                  restart()
                }}
              >
                {t('game.result.again')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
