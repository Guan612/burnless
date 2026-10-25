import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Healthz, PlayerRow } from '@burnless/shared'
import { authClient } from './auth-client'

export function useHealthz() {
  return useQuery({
    queryKey: ['healthz'],
    queryFn: async (): Promise<Healthz> => {
      const res = await fetch('/api/healthz')
      if (!res.ok) throw new Error(`healthz ${res.status}`)
      return res.json()
    },
    refetchInterval: 15_000,
  })
}

/** GET /api/me 响应：未登录时 user 为 null（前端会先自动匿名注册再查询） */
export interface MeResponse {
  user: { id: string; name: string; email?: string | null } | null
  /** 匿名游客标记：true = 未升级正式账号（进度只在本浏览器） */
  anonymous?: boolean
  rating?: number
  matches?: number
  unlocks?: string[]
  /** W7 账号升级：服务端配置了哪些 OAuth provider（能力位）、本人已绑定了哪些 */
  providers?: { github?: boolean }
  linked?: string[]
}

/**
 * 当前玩家档案。会话建立（含匿名自动注册）后才会发起请求，
 * refetch 让对局结算后的段位变化回到大厅/排行可见。
 */
export function useMe() {
  const session = authClient.useSession()
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<MeResponse> => {
      const res = await fetch('/api/me')
      if (!res.ok) throw new Error(`me ${res.status}`)
      return res.json()
    },
    enabled: !session.isPending && !!session.data,
    refetchInterval: 30_000,
  })

  // 无会话 → 匿名注册（起步即玩，决策 #19；默认昵称由服务端生成）
  if (!session.isPending && !session.data) {
    void authClient.signIn
      .anonymous()
      .then(() => qc.invalidateQueries({ queryKey: ['me'] }))
      .catch(() => {})
  }

  return query
}

export function useRank() {
  return useQuery({
    queryKey: ['rank'],
    queryFn: async (): Promise<{ players: PlayerRow[] }> => {
      const res = await fetch('/api/rank')
      if (!res.ok) throw new Error(`rank ${res.status}`)
      return res.json()
    },
  })
}

async function postJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'POST' })
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  return res.json()
}

export function useQuickMatch() {
  return useMutation({ mutationFn: () => postJson<{ matchId: string; queued: boolean }>('/api/match/quick') })
}

export function useCreatePrivate() {
  return useMutation({ mutationFn: () => postJson<{ matchId: string }>('/api/match/private') })
}
