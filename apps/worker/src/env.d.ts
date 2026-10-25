// wrangler types 不生成 secrets——手动合并进 Env
// secret 用 `wrangler secret put BETTER_AUTH_SECRET` 配置；本地开发放 .dev.vars
declare interface Env {
  BETTER_AUTH_SECRET: string
  /** W7 账号升级（可选）：GitHub OAuth 应用凭证（回调地址 <origin>/api/auth/callback/github）。
   *  `wrangler secret put` 配好即自动启用，未配置时 /api/me 报 providers.github=false、前端隐藏绑定入口 */
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  /** W8 找回密码/补绑邮箱（可选）：Resend 发信 API key（sending-only、限定 20020612.xyz）。
   *  `wrangler secret put RESEND_API_KEY` 配好即启用；未配置时发信会诚实报错 */
  RESEND_API_KEY?: string
}
