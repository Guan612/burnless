import { createT } from '@burnless/shared'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { CircleCheck, OctagonAlert } from 'lucide-react'
import { useState } from 'react'
import { authClient } from '../auth-client'

const t = createT('zh-CN')

type ResetSearch = { token?: string; error?: string }

/** 邮件重置链接的落地页：/reset-password?token=xxx（失效时 ?error=INVALID_TOKEN） */
export const Route = createFileRoute('/reset-password')({
  validateSearch: (search: Record<string, unknown>): ResetSearch => ({
    token: typeof search.token === 'string' ? search.token : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  component: ResetPage,
})

function ResetPage() {
  const { token, error: searchError } = Route.useSearch()
  const navigate = useNavigate()
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const submit = async () => {
    if (pwd.length < 8) {
      setError('密码至少 8 位')
      return
    }
    if (pwd !== pwd2) {
      setError('两次输入的密码不一致')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const r = await authClient.resetPassword({ newPassword: pwd, token })
      if (r.error) {
        const m = r.error.message ?? ''
        setError(m.includes('INVALID_TOKEN') ? '链接已失效或被用过，回大厅重新申请一封' : m || '重置失败，稍后再试')
      } else {
        setDone(true)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <section className="panel" style={{ maxWidth: 420, margin: '48px auto' }}>
        <div className="panel-head">
          <h2>重置密码</h2>
        </div>

        {/* 邮件链接带 error=INVALID_TOKEN：token 过期/已用 */}
        {searchError === 'INVALID_TOKEN' && !done && (
          <>
            <p className="err"><OctagonAlert size={13} /> 链接已失效或已被使用，请回大厅重新申请重置邮件</p>
            <div className="modal-actions">
              <button onClick={() => void navigate({ to: '/' })}>回大厅</button>
            </div>
          </>
        )}

        {searchError !== 'INVALID_TOKEN' && done && (
          <>
            <p className="acc-ok"><CircleCheck size={13} /> 密码已重置，用新密码登录吧（你的进度都还在）</p>
            <div className="modal-actions">
              <button onClick={() => void navigate({ to: '/' })}>去登录</button>
            </div>
          </>
        )}

        {searchError !== 'INVALID_TOKEN' && !done && (
          <>
            {!token && <p className="err"><OctagonAlert size={13} /> 缺少重置凭证：请从邮件里的链接进入本页</p>}
            <div className="account-fields">
              <input
                type="password"
                placeholder="新密码（至少 8 位）"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
              />
              <input
                type="password"
                placeholder="再输一遍"
                value={pwd2}
                onChange={(e) => setPwd2(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
              />
            </div>
            {error && <p className="err">{error}</p>}
            <div className="modal-actions">
              <button className="ghost" onClick={() => void navigate({ to: '/' })}>
                返回大厅
              </button>
              <button disabled={busy || !token} onClick={() => void submit()}>
                设置新密码
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
