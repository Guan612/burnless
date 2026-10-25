import { createT, gradeForRating, type GradeKey } from '@burnless/shared'
import { createFileRoute } from '@tanstack/react-router'
import { useMe, useRank } from '../api'

const t = createT('zh-CN')

/** 排位榜（W6）：按段位分 Top 20，自己高亮 */
export const Route = createFileRoute('/rank')({
  component: RankPage,
})

function RankPage() {
  const rank = useRank()
  const me = useMe()
  const myId = me.data?.user?.id

  return (
    <div className="page">
      <section className="panel">
        <div className="panel-head">
          <h2>{t('rank.title')}</h2>
          <span className="dim">{t('lobby.grade')} = 营收 + 口碑 的加权沉淀</span>
        </div>
        {rank.isPending && <p className="dim">{t('web.health.checking')}</p>}
        {rank.data && rank.data.players.length === 0 && <p className="dim">{t('rank.empty')}</p>}
        {rank.data && rank.data.players.length > 0 && (
          <table className="rank-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{t('rank.player')}</th>
                <th>{t('lobby.grade')}</th>
                <th>{t('rank.score')}</th>
                <th>{t('rank.matches')}</th>
              </tr>
            </thead>
            <tbody>
              {rank.data.players.map((p, i) => {
                const grade: GradeKey = gradeForRating(p.rating)
                return (
                  <tr key={p.id} className={p.id === myId ? 'me' : undefined}>
                    <td>{i + 1}</td>
                    <td>
                      {p.name}
                      {p.id === myId ? `（${t('rank.you')}）` : ''}
                    </td>
                    <td>{t(grade)}</td>
                    <td>
                      <b>{p.rating}</b>
                    </td>
                    <td>{p.matches}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
