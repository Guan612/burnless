import type Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { betterAuth } from 'better-auth'
import { anonymous } from 'better-auth/plugins'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
// 与 worker 共用同一份 better-auth drizzle schema（决策 #13：业务代码一行不改，只换执行器）
import * as authSchema from '../../worker/src/db/auth-schema'
import type { NodeConfig } from './config'

/** better-auth（决策 #19）：匿名起步 + 可选 GitHub OAuth；单进程单实例 */
export function createAuth(db: Database.Database, cfg: NodeConfig) {
  return betterAuth({
    secret: cfg.secret,
    database: drizzleAdapter(drizzle(db, { schema: authSchema }), { provider: 'sqlite', schema: authSchema }),
    // 与 worker 对齐：cf-connecting-ip 优先（若经 CF 代理），x-forwarded-for 兜底
    advanced: {
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'] },
    },
    // 邮件端点与 worker 同款收紧（单进程内存计数本就准确，无需落库；enabled 显式开与 worker 行为对齐）
    rateLimit: {
      enabled: true,
      customRules: {
        '/request-password-reset': { window: 3600, max: 5 },
        '/send-verification-email': { window: 3600, max: 5 },
        '/change-email': { window: 3600, max: 5 },
      },
    },
    plugins: [anonymous()],
    socialProviders: {
      ...(cfg.github ? { github: { clientId: cfg.github.clientId, clientSecret: cfg.github.clientSecret } } : {}),
    },
  })
}

/** 已绑定的第三方登录 provider（与 worker 同语义） */
export async function listLinkedProviders(db: Database.Database, userId: string): Promise<string[]> {
  const rows = await drizzle(db, { schema: authSchema })
    .select({ providerId: authSchema.account.providerId })
    .from(authSchema.account)
    .where(eq(authSchema.account.userId, userId))
  return [...new Set(rows.map((r) => r.providerId).filter((p) => p !== 'anonymous' && p !== 'credential'))]
}
