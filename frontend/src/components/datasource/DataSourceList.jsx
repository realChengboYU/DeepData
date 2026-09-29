import { useState } from 'react'
import { CircleCheck, Loader2, Pencil, Plus, Search, Table, Trash2 } from 'lucide-react'
import { useI18n } from '../../i18n'
import { DbTypeIcon } from './DbTypeIcon'
import './cards.css'

// 数据源列表（卡片网格 + 搜索/新建页头 + 空态/骨架）
export default function DataSourceList({ sources, activeId, busy, loading, onNew, onEdit, onViewTables, onAsk, onSetActive, onRemove }) {
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  if (!loading && sources.length === 0) {
    return (
      <div className="ds-empty dsrc-empty">
        <div className="ds-empty-mark" aria-hidden="true">
          <DbTypeIcon type="postgresql" size={40} />
        </div>
        <p className="ds-empty-title">{t('ds.emptyTitle')}</p>
        <p className="ds-empty-sub">{t('ds.emptySub')}</p>
        <button type="button" className="ds-btn ds-btn-primary" onClick={onNew}>
          <Plus /> {t('ds.new')}
        </button>
      </div>
    )
  }
  const kw = search.trim().toLowerCase()
  const shown = kw ? sources.filter((s) => (s.name || '').toLowerCase().includes(kw)) : sources

  if (loading) {
    return (
      <div className="ds-listwrap">
        <div className="ds-skel" aria-hidden="true">
          <div className="ds-skel-card" />
          <div className="ds-skel-card" />
        </div>
      </div>
    )
  }

  return (
    <div className="ds-listwrap">
      {/* 页头单行：标题（左）+ 搜索/新建（右），参考布局 */}
      <div className="dsrc-pagehead">
        <h1 className="dsrc-pagehead-title">{t('ds.title')}</h1>
        <label className="ds-toolbar-search">
          <Search />
          <input
            value={search}
            placeholder={t('ds.searchDs')}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button type="button" className="ds-btn ds-btn-primary" onClick={onNew}>
          <Plus /> {t('ds.new')}
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="ds-nomatch">{t('ds.noMatch')}</p>
      ) : (
        <div className="ds-list">
          {shown.map((s) => {
            const active = s.id === activeId
            return (
              <article key={s.id} className={`ds-card${active ? ' active' : ''}`}>
                <div
                  className="ds-card-head"
                  role="button"
                  tabIndex={0}
                  aria-label={`${t('ds.ask')} · ${s.name}`}
                  onClick={() => onAsk && onAsk(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      if (onAsk) onAsk(s.id)
                    }
                  }}
                >
                  <span className="ds-card-icon" aria-hidden="true">
                    <DbTypeIcon type={s.type || 'postgresql'} size={50} />
                  </span>
                  <div className="ds-card-info">
                    <div className="ds-card-namerow">
                      <span className="ds-card-name">{s.name}</span>
                      {active ? <span className="ds-card-status">{t('ds.active')}</span> : null}
                    </div>
                    <span className="ds-card-type">
                      PostgreSQL{s.schema && s.schema !== 'public' ? ` · ${s.schema}` : ''}
                    </span>
                    <code
                      className="ds-card-conn"
                      title={`postgresql+psycopg://${s.username}@${s.host}:${s.port}/${s.dbname}`}
                    >
                      {s.username ? `${s.username}@` : ''}{s.host}:{s.port}/{s.dbname}
                    </code>
                  </div>
                </div>
                <div className="ds-card-metric">
                  <Table aria-hidden="true" />
                  <span>{typeof s.num === 'number' ? s.num : 0} {t('ds.tablesShort')}</span>
                  <span className="ds-card-actions">
                    {!active ? (
                      <button
                        type="button"
                        className="ds-act-btn"
                        disabled={busy === s.id}
                        title={t('ds.setActive')}
                        onClick={() => onSetActive(s.id)}
                      >
                        <CircleCheck />
                      </button>
                    ) : null}
                    <button type="button" className="ds-act-btn" title={t('ds.viewTables')} onClick={() => onViewTables(s)}>
                      <Table />
                    </button>
                    <button type="button" className="ds-act-btn" title={t('ds.edit')} onClick={() => onEdit(s)}>
                      <Pencil />
                    </button>
                    <button
                      type="button"
                      className="ds-act-btn danger"
                      disabled={busy === s.id}
                      title={t('ds.delete')}
                      onClick={() => onRemove(s)}
                    >
                      {busy === s.id ? <Loader2 className="spin" /> : <Trash2 />}
                    </button>
                  </span>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
