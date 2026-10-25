import { useQueryClient } from '@tanstack/react-query'
import { AtSign, Mail, User, X } from 'lucide-react'
import { useState } from 'react'
import { useMe } from './api'
import { authClient } from './auth-client'
import { sfx } from './game/sfx'

/** 用户名号占位凭证邮箱的后缀（真实邮箱补绑后替换，找回密码即通） */
const DUMMY_EMAIL_SUFFIX = '@users.local'

/** 用户名规则（与服务端 username 插件校验器一致）：中文/字母/数字/_/-，2~16 位 */
const USERNAME_RE = /^[\w\u4e00-\u9fa5-]{2,16}$/

/** 错误码 → 人话（better-auth 的报错是英文码） */
function toHumanError(message?: string): string {
  const m = message ?? ''
  if (m.includes('USER_ALREADY_EXISTS')) return '这个邮箱已经注册过了，试试「登录已有账号」'
  if (m.includes('USERNAME_IS_ALREADY_TAKEN')) return '这个用户名已被占用'
  if (m.includes('INVALID_USERNAME') || m.includes('USERNAME_TOO_')) return '用户名只能用中文、字母、数字、_ 或 -，2~16 位'
  if (m.includes('INVALID_EMAIL_OR_PASSWORD') || m.includes('INVALID_USERNAME_OR_PASSWORD')) return '账号或密码不对'
  if (m.includes('PASSWORD_TOO_')) return '密码至少 8 位'
  if (m.includes('INVALID_EMAIL')) return '邮箱格式不对'
  // 发信失败上抛成 500：诚实告知邮件没发出去（而不是假"已发送"）
  if (m.includes('Internal Server Error') || m.includes('INTERNAL_SERVER_ERROR')) {
    return '发送失败：服务端邮件通道暂不可用（管理员需在 Cloudflare 面板给 20020612.xyz 开通 Email Sending）'
  }
  return m || '操作失败，稍后再试'
}

/**
 * 页头账号入口（W8 邮箱/用户名双轨）：
 * - 游客（匿名会话）：注册正式号原地继承进度（服务端 onLinkAccount 过户），或登录已有账号
 *   · 邮箱号：邮箱 + 密码
 *   · 用户名号：用户名 + 密码（凭证用保留域 @users.local 占位，纯用户名登录）
 * - 正式账号：显示档案 + 退出；换浏览器登录同一账号即接回进度
 */
export function AccountMenu() {
  const me = useMe()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'email' | 'username'>('email')
  const [view, setView] = useState<'main' | 'forgot'>('main') // 登录区子视图：忘记密码表单
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [bindEmail, setBindEmail] = useState('') // 补绑邮箱输入（用户名号）

  const data = me.data
  const user = data?.user
  const isGuest = !!user && (data?.anonymous ?? true)
  const githubReady = !!data?.providers?.github
  const githubLinked = !!data?.linked?.includes('github')
  /** 用户名号：凭证是 @users.local 占位邮箱，补绑真实邮箱后找回密码才通 */
  const needsEmailBinding = !!user && !isGuest && !!data?.user?.email?.endsWith(DUMMY_EMAIL_SUFFIX)

  const finish = () => {
    sfx.play('ui_confirm')
    setError(null)
    setOpen(false)
    void qc.invalidateQueries({ queryKey: ['me'] })
  }

  const signUp = async () => {
    const name = nickname.trim() || (mode === 'username' ? username.trim() : user?.name || '摊主')
    setError(null)
    if (mode === 'email') {
      if (!email.includes('@') || password.length < 8) {
        setError('填个有效邮箱，密码至少 8 位')
        return
      }
      setBusy(true)
      try {
        const r = await authClient.signUp.email({ email, password, name })
        if (r.error) setError(toHumanError(r.error.message))
        else finish()
      } finally {
        setBusy(false)
      }
      return
    }
    // 用户名号：凭证邮箱用保留域 @users.local 占位（不收邮件，仅满足 user.email NOT NULL UNIQUE）
    if (!USERNAME_RE.test(username.trim()) || password.length < 8) {
      setError('用户名只能用中文、字母、数字、_ 或 -，2~16 位；密码至少 8 位')
      return
    }
    setBusy(true)
    try {
      const r = await authClient.signUp.email({
        email: `${username.trim().toLowerCase()}@users.local`,
        password,
        name,
        username: username.trim(),
      })
      if (r.error) setError(toHumanError(r.error.message))
      else finish()
    } finally {
      setBusy(false)
    }
  }

  const signIn = async () => {
    setError(null)
    if (password.length < 8) {
      setError('密码至少 8 位')
      return
    }
    setBusy(true)
    try {
      // 含 @ 走邮箱，否则当用户名；两套账号都能这样登
      const r =
        email.includes('@')
          ? await authClient.signIn.email({ email, password })
          : await authClient.signIn.username({ username: email.trim(), password })
      if (r.error) setError(toHumanError(r.error.message))
      else finish()
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    setBusy(true)
    try {
      await authClient.signOut()
      // 会话清空后 useMe 会自动注册新游客，invalidate 让档案回到游客态
      void qc.invalidateQueries({ queryKey: ['me'] })
      sfx.play('ui_tick')
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const bindGithub = () => {
    void authClient.linkSocial({ provider: 'github', callbackURL: window.location.origin + '/' })
  }

  /** 忘记密码：向注册邮箱发重置链接（用户名号无真实邮箱，客户端直接拦） */
  const sendReset = async () => {
    setError(null)
    setOkMsg(null)
    if (email.endsWith(DUMMY_EMAIL_SUFFIX)) {
      setError('用户名号没有真实邮箱，不能直接重置：先用密码登录，在账号里补绑邮箱')
      return
    }
    if (!email.includes('@')) {
      setError('填个有效邮箱')
      return
    }
    setBusy(true)
    try {
      const r = await authClient.requestPasswordReset({ email, redirectTo: window.location.origin + '/reset-password' })
      if (r.error) setError(toHumanError(r.error.message))
      else {
        // 发信在服务端后台执行，HTTP 恒 200：话术必须防枚举且不打包票
        setOkMsg('若该邮箱已注册，重置邮件已发出（链接 1 小时内有效）。没收到：翻垃圾箱；持续收不到说明邮件通道未开通，找管理员在 CF 面板开通 Email Sending')
        sfx.play('ui_confirm')
      }
    } finally {
      setBusy(false)
    }
  }

  /** 补绑邮箱（用户名号）：changeEmail 向新邮箱发确认信，点击后绑定生效 */
  const bindEmailNow = async () => {
    setError(null)
    setOkMsg(null)
    if (!bindEmail.includes('@')) {
      setError('填个有效邮箱')
      return
    }
    setBusy(true)
    try {
      const r = await authClient.changeEmail({ newEmail: bindEmail, callbackURL: window.location.origin + '/' })
      if (r.error) setError(toHumanError(r.error.message))
      else {
        setOkMsg('确认邮件已发到新邮箱，点邮件里的链接后绑定生效')
        sfx.play('ui_confirm')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        className="icon-btn account-btn"
        onClick={() => {
          sfx.play('ui_tick')
          setError(null)
          setOkMsg(null)
          setView('main')
          setOpen(true)
        }}
        aria-label="账号"
      >
        <User size={15} />
        <span className="account-name">{user ? user.name : '…'}</span>
      </button>

      {open && (
        <div className="modal-backdrop pe">
          <div className="modal account-modal">
            <button className="modal-close" onClick={() => setOpen(false)} aria-label="关闭">
              <X size={14} />
            </button>
            <h3>账号</h3>
            {user && isGuest && view === 'forgot' && (
              <>
                <p className="dim">输入注册邮箱，发一封重置邮件（链接 1 小时内有效）。</p>
                <div className="account-fields">
                  <input
                    type="email"
                    placeholder="注册邮箱"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void sendReset()}
                  />
                </div>
                {error && <p className="err">{error}</p>}
                {okMsg && <p className="acc-ok">{okMsg}</p>}
                <div className="modal-actions">
                  <button
                    className="ghost"
                    onClick={() => {
                      setView('main')
                      setError(null)
                      setOkMsg(null)
                    }}
                  >
                    返回
                  </button>
                  <button disabled={busy} onClick={() => void sendReset()}>
                    <Mail size={13} /> 发送重置邮件
                  </button>
                </div>
              </>
            )}
            {user && isGuest && view === 'main' && (
              <>
                <p className="dim">
                  当前游客 <b>{user.name}</b> · 段位 {data?.rating ?? '-'} · 换浏览器进度会丢
                </p>

                {/* 登录：一个输入框，含 @ 走邮箱、否则走用户名 */}
                <div className="account-fields">
                  <input
                    placeholder="邮箱或用户名"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void signIn()}
                  />
                  <input
                    type="password"
                    placeholder="密码"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void signIn()}
                  />
                </div>
                {error && <p className="err">{error}</p>}
                <div className="modal-actions">
                  <button disabled={busy} onClick={() => void signIn()}>
                    登录已有账号
                  </button>
                </div>
                <button
                  className="link-like"
                  onClick={() => {
                    setView('forgot')
                    setError(null)
                    setOkMsg(null)
                  }}
                >
                  忘记密码？
                </button>

                <p className="account-divider">没有账号？选一种方式注册（继承当前进度）</p>
                <div className="seg">
                  <button className={mode === 'email' ? 'active' : ''} onClick={() => { setMode('email'); setError(null) }}>
                    <Mail size={13} /> 邮箱
                  </button>
                  <button className={mode === 'username' ? 'active' : ''} onClick={() => { setMode('username'); setError(null) }}>
                    <AtSign size={13} /> 用户名
                  </button>
                </div>
                <div className="account-fields">
                  {mode === 'email' ? (
                    <input
                      type="email"
                      placeholder="邮箱"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void signUp()}
                    />
                  ) : (
                    <input
                      placeholder="用户名（中文/字母/数字/_/-，2~16 位）"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void signUp()}
                    />
                  )}
                  <input
                    type="password"
                    placeholder="密码（至少 8 位）"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void signUp()}
                  />
                  <input
                    placeholder="摊主昵称（可选，默认沿用游客名）"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                  />
                </div>
                {mode === 'username' && <p className="dim">用户名号纯靠用户名+密码登录，没法用邮箱找回密码，密码记牢</p>}
                <div className="modal-actions">
                  <button className="ghost" disabled={busy} onClick={() => void signUp()}>
                    注册并继承进度
                  </button>
                </div>
                {githubReady && !githubLinked && (
                  <p className="dim">
                    或{' '}
                    <button className="chip-link" onClick={bindGithub}>
                      绑定 GitHub
                    </button>
                    （进度同样跟账号走）
                  </p>
                )}
              </>
            )}
            {user && !isGuest && (
              <>
                <p>
                  <b>{user.name}</b>
                  {data?.user?.email && !data.user.email.endsWith(DUMMY_EMAIL_SUFFIX) ? ` · ${data.user.email}` : ''}
                  {githubLinked ? ' · 已绑 GitHub' : ''}
                </p>
                <p className="dim">
                  段位 {data?.rating ?? '-'} · 场次 {data?.matches ?? 0} · 换浏览器登录同一账号即接回进度
                </p>
                {needsEmailBinding && (
                  <>
                    <p className="account-divider">补绑邮箱（找回密码 + 邮箱登录）</p>
                    <div className="account-fields">
                      <input
                        type="email"
                        placeholder="你的真实邮箱"
                        value={bindEmail}
                        onChange={(e) => setBindEmail(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void bindEmailNow()}
                      />
                    </div>
                    <p className="dim">确认邮件发到新邮箱，点邮件里的链接后绑定生效</p>
                  </>
                )}
                {error && <p className="err">{error}</p>}
                {okMsg && <p className="acc-ok">{okMsg}</p>}
                <div className="modal-actions">
                  {needsEmailBinding && (
                    <button disabled={busy} onClick={() => void bindEmailNow()}>
                      <Mail size={13} /> 发送确认邮件
                    </button>
                  )}
                  <button className="ghost" disabled={busy} onClick={() => void signOut()}>
                    退出登录
                  </button>
                </div>
              </>
            )}
            {!user && <p className="dim">会话建立中…</p>}
          </div>
        </div>
      )}
    </>
  )
}
