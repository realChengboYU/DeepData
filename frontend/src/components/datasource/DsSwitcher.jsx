import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import pgIcon from '../../assets/ds/pg.svg'
import './ds-switcher.css'

// 数据源切换器：每个会话窗口只针对一个库对话，可在此切换（切换会持久化到该会话）
export default function DsSwitcher({ value, sources, onChange, t }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const cur = sources.find((s) => s.id === value)
  return (
    <div className="ds-switcher" ref={wrapRef}>
      <button
        type="button"
        className="ds-switcher-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t('ds.switchSource')}
        onClick={() => setOpen((o) => !o)}
      >
        <img className="ds-switcher-ic" src={pgIcon} width={16} height={16} alt="" aria-hidden="true" />
        <span className="ds-switcher-label">{cur ? cur.name : t('ds.none')}</span>
        <ChevronDown className={`ds-switcher-caret${open ? ' open' : ''}`} />
      </button>
      {open && (
        <div className="ds-switcher-menu" role="listbox">
          {sources.length === 0 ? (
            <div className="ds-switcher-empty">{t('ds.noSource')}</div>
          ) : (
            sources.map((s) => (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={s.id === value}
                className={`ds-switcher-opt${s.id === value ? ' active' : ''}`}
                onClick={() => { onChange(s.id); setOpen(false) }}
              >
                <span className="ds-switcher-opt-main">{s.name}</span>
                <span className="ds-switcher-opt-sub">{s.dbname ? `/${s.dbname}` : ''}</span>
                {s.id === value ? <Check className="ds-switcher-opt-check" /> : null}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
