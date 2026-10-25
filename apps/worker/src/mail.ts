/**
 * W8 邮件发送：Resend REST API（免费档 100 封/天，找回密码这种低频邮件绰绰有余）。
 * 直接 fetch，不引 SDK（Workers 上省 bundle）；API key 走 secret（wrangler secret put RESEND_API_KEY），
 * 绝不进代码/日志/聊天。发件域名 20020612.xyz 须在 Resend 控制台验证通过（DNS 记录加在 Cloudflare）。
 * 发信失败原样上抛：找回密码/补绑邮箱必须如实告知用户"邮件没发出去"，
 * 静默吞掉会让用户对着"已发送"的假话等一小时的邮件。
 */
const FROM = '不烧心 <noreply@20020612.xyz>'
const RESEND_ENDPOINT = 'https://api.resend.com/emails'

async function sendMail(env: Env, to: string, subject: string, text: string, html: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    throw new Error('MAIL_NOT_CONFIGURED: RESEND_API_KEY 未配置（wrangler secret put RESEND_API_KEY）')
  }
  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to: [to], subject, text, html }),
  })
  if (!res.ok) {
    // 401=key 错 / 403=域名未验证 / 422=收件人或发件人不合法 / 429=限速
    const detail = await res.text().catch(() => '')
    console.error('[mail] resend failed:', res.status, detail)
    throw new Error(`RESEND_ERROR ${res.status}: ${detail.slice(0, 200)}`)
  }
}

/** 邮件正文（text + html 双版本，spam 分更稳） */
function mailHtml(title: string, lines: string[], url?: string): string {
  const body = lines.map((l) => `<p style="margin:0 0 12px">${l}</p>`).join('')
  return `<div style="background:#191320;color:#f0e6d2;font-family:system-ui,sans-serif;padding:24px;border-radius:8px;max-width:480px">
  <h2 style="margin:0 0 16px;color:#e8b04b;font-size:18px">${title}</h2>
  ${body}
  ${
    url
      ? `<a href="${url}" style="display:inline-block;background:#e8b04b;color:#16130f;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:bold">点此操作</a>
  <p style="color:#8f8478;font-size:12px;margin:16px 0 0">按钮没反应就把这个链接粘到浏览器打开：<br>${url}</p>`
      : ''
  }
</div>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

/** 忘记密码：重置链接 1 小时内有效（better-auth 默认 token 时效） */
export async function sendResetMail(env: Env, name: string, to: string, url: string): Promise<void> {
  const subject = '不烧心 · 重置密码'
  const text = `${name}，你的摊位账号申请了重置密码。点击链接设置新密码（1 小时内有效）：\n\n${url}\n\n如果不是你本人的操作，忽略这封邮件即可。`
  const html = mailHtml(
    '重置密码',
    [`${escapeHtml(name)}，你的摊位账号申请了重置密码。`, '点击下面的按钮设置新密码（1 小时内有效）。', '如果不是你本人的操作，忽略这封邮件即可。'],
    url,
  )
  await sendMail(env, to, subject, text, html)
}

/** 补绑邮箱：changeEmail 的确认信，收件人是新邮箱，点击后绑定才生效 */
export async function sendBindMail(env: Env, name: string, to: string, url: string): Promise<void> {
  const subject = '不烧心 · 确认新邮箱'
  const text = `${name}，你的摊位账号申请绑定邮箱 ${to}。点击链接完成绑定（链接尽快使用，有过期时间）：\n\n${url}\n\n如果不是你本人的操作，忽略这封邮件即可。`
  const html = mailHtml(
    '确认新邮箱',
    [`${escapeHtml(name)}，你的摊位账号申请绑定邮箱 <b>${escapeHtml(to)}</b>。`, '点击下面的按钮完成绑定。', '如果不是你本人的操作，忽略这封邮件即可。'],
    url,
  )
  await sendMail(env, to, subject, text, html)
}
