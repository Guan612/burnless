import { Link, createRootRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { Volume2, VolumeX } from 'lucide-react'
import { useState } from 'react'
import { createT } from '@burnless/shared'
import { useHealthz } from '../api'
import { AccountMenu } from '../AccountMenu'
import { sfx } from '../game/sfx'

const t = createT('zh-CN')

/** 根布局：标题 + tab 导航 + 服务状态。旋转引导不放这里：对局专属（StreetTab），大厅等页竖屏直接可用 */
export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const health = useHealthz()
  const [muted, setMuted] = useState(sfx.isMuted)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  // 矮横屏（手机打匹配）走沉浸式：页头页脚隐藏，街景全屏，快捷键悬浮在 StreetTab 里
  const immersive = pathname.startsWith('/match/')
  const healthLabel = health.isPending
    ? t('web.health.checking')
    : health.data?.ok
      ? t('web.health.online')
      : t('web.health.offline')
  const soundLabel = muted ? t('web.sound.unmute') : t('web.sound.mute')

  return (
    <div className={`app${immersive ? ' immersive' : ''}`}>
      <header className="head">
        <div>
          <h1>{t('app.title')}</h1>
          <p className="tagline">{t('app.tagline')}</p>
        </div>
        <div className="head-right">
          <AccountMenu />
          <button
            className={`icon-btn${muted ? ' off' : ''}`}
            onClick={() => setMuted(sfx.toggle())}
            title={soundLabel}
            aria-label={soundLabel}
          >
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <nav className="tabs">
            <Link to="/" activeOptions={{ exact: true }} activeProps={{ className: 'active' }}>
              大厅
            </Link>
            <Link to="/rank" activeProps={{ className: 'active' }}>
              排行
            </Link>
            <Link to="/collection" activeProps={{ className: 'active' }}>
              收藏
            </Link>
            <Link to="/echo" activeProps={{ className: 'active' }}>
              回声房
            </Link>
          </nav>
          <span className={`badge ${health.data?.ok ? 'ok' : 'bad'}`}>
            {t('web.health.title')}：{healthLabel}
          </span>
        </div>
      </header>

      <main className="content">
        <Outlet />
      </main>

      <footer className="footer dim">W6 · 局外闭环 —— 匿名登录 · 段位 · 排位榜 · 收藏 · 私房邀请码</footer>
    </div>
  )
}
