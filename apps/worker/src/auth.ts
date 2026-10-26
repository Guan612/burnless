import { betterAuth } from 'better-auth'
import { anonymous, username } from 'better-auth/plugins'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import * as authSchema from './db/auth-schema'
import { createD1Adapter } from './db/d1'
import { sendBindMail, sendResetMail } from './mail'

function createAuthValue(env: Env) {
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(drizzle(env.DB, { schema: authSchema }), { provider: 'sqlite', schema: authSchema }),
    // Cloudflare 边缘的权威客户端 IP 头（单值、不可伪造）；x-forwarded-for 兜底（Node 逃生舱/本地）
    advanced: {
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'] },
    },
    // 限流落库：Workers 多 isolate 内存计数形同虚设；计数行进 rate_limit 表（迁移 0003），全局一致。
    // enabled 必须显式开——workerd 没有 process.env.NODE_ENV，better-auth 的 isProduction 恒 false，
    // 默认配置下生产环境限流根本不生效。邮件端点收紧到 5 封/小时/IP：默认 3 次/分钟理论上 1 小时
    // 能发 180 封，够把 Resend 免费档 100 封/天的配额打爆，也会变成对受害者邮箱的轰炸。
    // 正常使用一小时绝不会要 5 封验证信。（1.7 的找回密码路由是 /request-password-reset）
    rateLimit: {
      enabled: true,
      storage: 'database',
      customRules: {
        '/request-password-reset': { window: 3600, max: 5 },
        '/send-verification-email': { window: 3600, max: 5 },
        '/change-email': { window: 3600, max: 5 },
      },
    },
    // W8 邮箱账号：Workers 上 better-auth 自动走 @noble 纯 JS scrypt（node:crypto 不可用），无需额外配置
    emailAndPassword: {
      enabled: true,
      // 找回密码：CF Email Service 直发重置链接（token 默认 1 小时有效）
      sendResetPassword: async ({ user, url }) => {
        await sendResetMail(env, user.name || '摊主', user.email, url)
      },
    },
    // W8 邮箱验证信：1.7.12 的 changeEmail 补绑流程复用此回调发确认信（未验证邮箱走此兜底，
    // 入参 user.email 已被替换为新邮箱），点链接后邮箱才真正更新（顺便验证归属）
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await sendBindMail(env, user.name || '摊主', user.email, url)
      },
    },
    // W8 补绑邮箱：changeEmail 默认关闭（不开就报 CHANGE_EMAIL_DISABLED），显式开启即可
    user: {
      changeEmail: { enabled: true },
    },
    plugins: [
      // W8 用户名账号：注册可选 username（纯用户名号用保留域 @users.local 占位邮箱，见 AccountMenu）
      username({
        minUsernameLength: 2,
        maxUsernameLength: 16,
        usernameValidator: (u) => /^[\w\u4e00-\u9fa5-]+$/.test(u),
      }),
      anonymous({
        // 账号升级过户：游客注册邮箱号瞬间，把游戏档案（段位/历史/收藏）迁到正式账号名下。
        // 只认 /sign-up（真升级）；登录已有账号时本地游客由插件自行清理，不过户
        onLinkAccount: async ({ anonymousUser, newUser, ctx }) => {
          const path = (ctx as { path?: string }).path ?? ''
          if (!path.startsWith('/sign-up')) return
          const name = /^anonymous/i.test(newUser.user.name) ? undefined : newUser.user.name
          await createD1Adapter(env.DB).migratePlayer(anonymousUser.user.id, newUser.user.id, name)
        },
      }),
    ],
    // W7 账号升级：secrets 配了才注册 provider（匿名用户 linkSocial 即绑定，段位/收藏跟账号走）
    socialProviders: {
      ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
        ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } }
        : {}),
    },
  })
}

/**
 * better-auth（决策 #19）：匿名登录起步即玩；GitHub OAuth / 邮箱升级路径由
 * plugins 与 env secrets 扩展（W7 打磨期接入，MVP 只开匿名）。
 * 实例按 DB 绑定缓存（一个 isolate 一份），别每请求重建。
 */
const cache = new WeakMap<D1Database, ReturnType<typeof createAuthValue>>()

export function createAuth(env: Env) {
  const cached = cache.get(env.DB)
  if (cached) return cached
  const auth = createAuthValue(env)
  cache.set(env.DB, auth)
  return auth
}

/** 已绑定的第三方登录 provider（'github'…；匿名/密码占位账户不算「绑定」） */
export async function listLinkedProviders(env: Env, userId: string): Promise<string[]> {
  const db = drizzle(env.DB, { schema: authSchema })
  const rows = await db
    .select({ providerId: authSchema.account.providerId })
    .from(authSchema.account)
    .where(eq(authSchema.account.userId, userId))
  return [
    ...new Set(rows.map((r) => r.providerId).filter((p) => p !== 'anonymous' && p !== 'credential')),
  ]
}
