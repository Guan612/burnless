import { existsSync } from 'node:fs'
import path from 'node:path'

/** 自部署配置：全部走环境变量，零 Cloudflare 概念 */
export interface NodeConfig {
  port: number
  dbPath: string
  /** web 构建产物目录（../web/dist）；不存在则降级为 API-only 模式 */
  assetsDir: string | null
  secret: string
  /** GitHub OAuth（可选，配齐才启用绑定入口） */
  github: { clientId: string; clientSecret: string } | null
}

export function loadConfig(): NodeConfig {
  const port = Number(process.env.PORT ?? 8787)
  const dbPath = process.env.BURNLESS_DB ?? path.resolve('data/burnless.sqlite')
  const secret = process.env.BETTER_AUTH_SECRET ?? 'burnless-dev-secret-change-me'
  const assets = process.env.ASSETS_DIR ?? path.resolve('../web/dist')
  const clientId = process.env.GITHUB_CLIENT_ID
  const clientSecret = process.env.GITHUB_CLIENT_SECRET
  return {
    port,
    dbPath,
    assetsDir: existsSync(assets) ? assets : null,
    secret,
    github: clientId && clientSecret ? { clientId, clientSecret } : null,
  }
}
