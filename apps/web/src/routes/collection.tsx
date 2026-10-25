import { COLLECTION, createT } from '@burnless/shared'
import { createFileRoute } from '@tanstack/react-router'
import { Lock } from 'lucide-react'
import { useMe } from '../api'

const t = createT('zh-CN')

/** 收藏页（W6）：纯外观收集，单局综合分达阈值解锁 */
export const Route = createFileRoute('/collection')({
  component: CollectionPage,
})

function CollectionPage() {
  const me = useMe()
  const unlocked = new Set(me.data?.unlocks ?? [])

  return (
    <div className="page">
      <section className="panel">
        <div className="panel-head">
          <h2>{t('collection.title')}</h2>
          <span className="dim">{t('collection.hint')}</span>
        </div>
        <div className="collect-grid">
          {COLLECTION.map((item) => {
            const has = unlocked.has(item.id)
            return (
              <div key={item.id} className={`collect-card ${has ? '' : 'locked'}`}>
                <h3>{has ? <>{t(item.nameKey as 'collect.item.lantern.name')}</> : <><Lock size={12} /> {t('collection.locked')}</>}</h3>
                <p className="dim">{t(item.descKey as 'collect.item.lantern.desc')}</p>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
