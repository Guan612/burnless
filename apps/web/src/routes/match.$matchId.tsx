import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { createT } from '@burnless/shared'
import { useMe } from '../api'
import { useMatchRoom } from '../game/useMatchRoom'
import { StreetTab } from '../street/StreetTab'

const t = createT('zh-CN')

/** 对局路由：/match/:matchId 即房间号（快速匹配/私房邀请码都落到这） */
export const Route = createFileRoute('/match/$matchId')({
  component: MatchPage,
})

function MatchPage() {
  const { matchId } = Route.useParams()
  const me = useMe()
  const user = me.data?.user

  // 等匿名会话就绪再挂对局：首条 hello 就带身份，结算必落库
  if (!user) {
    return (
      <div className="page">
        <section className="panel">
          <p className="dim">{t('lobby.guest')}</p>
        </section>
      </div>
    )
  }
  return <MatchGame matchId={matchId} playerId={user.id} playerName={user.name} />
}

function MatchGame(props: { matchId: string; playerId: string; playerName: string }) {
  const navigate = useNavigate()
  const game = useMatchRoom(props.matchId, (id) => {
    void navigate({ to: '/match/$matchId', params: { matchId: id } })
  }, props.playerId, props.playerName)
  return <StreetTab game={game} />
}
