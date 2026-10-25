import { createT, gradeForRating, type GradeKey } from '@burnless/shared'
import { useNavigate, createFileRoute, redirect } from '@tanstack/react-router'
import { History, Link2, Lock, Medal, Play, Trophy, Zap } from 'lucide-react'
import { useState } from 'react'
import { useCreatePrivate, useMe, useQuickMatch } from '../api'
import { authClient } from '../auth-client'
import { lastMatchId } from '../game/useMatchRoom'

const t = createT('zh-CN')

/** 大厅（W6）：档案卡 + 快速匹配 + 私房邀请码 + 继续上一局（验收起点：点开链接即在此页） */
export const Route = createFileRoute('/')({
  beforeLoad: ({ search }) => {
    // 旧 ?match= 链接兼容：重定向到对局路由
    const m = (search as Record<string, unknown>)['match']
    if (typeof m === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(m)) {
      throw redirect({ to: '/match/$matchId', params: { matchId: m } })
    }
  },
  component: LobbyPage,
})

function LobbyPage() {
  const me = useMe()
  const navigate = useNavigate()
  const quick = useQuickMatch()
  const createPrivate = useCreatePrivate()
  const [joinCode, setJoinCode] = useState('')
  const [queued, setQueued] = useState(false)
  const last = lastMatchId()

  const goMatch = (matchId: string) => {
    void navigate({ to: '/match/$matchId', params: { matchId } })
  }

  const rating = me.data?.rating
  const gradeKey: GradeKey | null = typeof rating === 'number' ? gradeForRating(rating) : null

  return (
    <div className="page">
      <section className="panel">
        <div className="panel-head">
          <h2>{t('lobby.title')}</h2>
          <span className="dim">{me.isPending ? t('lobby.guest') : (me.data?.user?.name ?? '')}</span>
        </div>
        {me.data?.user && (
          <div className="profile-row">
            <span className="chip"><Trophy size={12} /> {t('lobby.rating')} {rating ?? '-'}</span>
            <span className="chip">
              <Medal size={12} /> {t('lobby.grade')} {gradeKey ? t(gradeKey) : '-'}
            </span>
            <span className="chip"><History size={12} /> {t('lobby.matches')} {me.data.matches ?? 0}</span>
            {/* W7 账号升级：服务端配了 GitHub OAuth 且本人尚未绑定才显示（匿名档位/收藏随绑定保留） */}
            {me.data.providers?.github && !me.data.linked?.includes('github') && (
                <button
                  className="chip-link"
                  onClick={() =>
                    void authClient.linkSocial({ provider: 'github', callbackURL: window.location.origin + '/' })
                  }
                >
                  <Link2 size={12} /> {t('lobby.link.github')}
                </button>
            )}
          </div>
        )}

        <div className="lobby-actions">
          <button
            disabled={quick.isPending}
            onClick={() => {
              setQueued(true)
              quick.mutate(undefined, {
                onSuccess: (r) => goMatch(r.matchId),
                onSettled: () => setQueued(false),
              })
            }}
          >
            <Zap size={13} /> {queued ? t('lobby.queuing') : t('lobby.quick')}
          </button>
          <button className="ghost" disabled={createPrivate.isPending} onClick={() => createPrivate.mutate(undefined, { onSuccess: (r) => goMatch(r.matchId) })}>
            <Lock size={13} /> {t('lobby.private.create')}
          </button>
          {last && (
            <button className="ghost" onClick={() => goMatch(last)}>
              <Play size={13} /> {t('lobby.continue')}
            </button>
          )}
        </div>

        <div className="row">
          <input
            value={joinCode}
            placeholder={t('lobby.private.placeholder')}
            onChange={(e) => setJoinCode(e.target.value.trim().toLowerCase())}
            onKeyDown={(e) => e.key === 'Enter' && joinCode.length >= 4 && goMatch(`p-${joinCode}`)}
          />
          <button disabled={joinCode.length < 4} onClick={() => goMatch(`p-${joinCode}`)}>
            {t('lobby.private.join')}
          </button>
        </div>
        <p className="dim">{t('lobby.new')}</p>
      </section>
    </div>
  )
}
