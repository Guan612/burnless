import { createAuthClient } from 'better-auth/react'
import { anonymousClient, usernameClient } from 'better-auth/client/plugins'

/**
 * better-auth 客户端（决策 #19）：同源 cookie 会话，首次进站自动匿名注册。
 * 邮箱/用户名双轨注册登录（W8）；GitHub OAuth 配置服务端 secrets 后即插即用。
 */
export const authClient = createAuthClient({
  plugins: [anonymousClient(), usernameClient()],
})
