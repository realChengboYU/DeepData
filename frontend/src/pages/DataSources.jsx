import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, Database, X } from 'lucide-react'
import { useI18n } from '../i18n'
import { deleteDataSource, getDataSources, setDataSourceActive, testDataSource } from '../api'
import { DbTypeIcon } from '../components/datasource/DbTypeIcon'
import DataSourceForm from '../components/datasource/DataSourceForm'
import DataSourceList from '../components/datasource/DataSourceList'
import TableSelectStep from '../components/datasource/TableSelectStep'
import '../components/datasource/datasource.css'
import '../components/datasource/overlays.css'

// 数据源页编排器：视图路由（列表 / 新建向导 / 编辑 sheet / 查看表）+ 删除确认。
// 各区块实现见 components/datasource/ 下的组件文件（各自携带样式）。
export default function DataSources({ onBackToChat, onAsk }) {
  const { t } = useI18n()
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState('list') // 'list' | 'new' | 'edit' | 'tables'
  const [newStep, setNewStep] = useState('form') // 'form' | 'tables'（类型选择已并入表单首组）
  const [confirmDel, setConfirmDel] = useState(null) // 待删除确认的数据源
  const [editing, setEditing] = useState(null)
  const [currentId, setCurrentId] = useState(null) // 当前向导流程中的数据源 id
  const [freshCreated, setFreshCreated] = useState(false) // 「下一步」刚建、还没保存表的源（取消时删）
  const [busy, setBusy] = useState('')
  const [testingId, setTestingId] = useState('')
  const [notice, setNotice] = useState(null) // { ok, msg } —— 页内横幅（测试通过/失败、删除/激活失败等）
  const noticeTimer = useRef(null)
  const hadActiveRef = useRef(false)

  // 短暂闪现一条页内提示（成功绿 / 失败红），几秒后自动消失
  const flash = useCallback((msg, ok = false) => {
    if (!msg) return
    setNotice({ ok, msg })
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 6000)
  }, [])

  const activeId = sources.find((s) => s.is_active)?.id ?? null

  const load = useCallback(() => {
    setLoading(true)
    getDataSources()
      .then((d) => {
        const list = d?.sources ?? []
        setSources(list)
        hadActiveRef.current = list.some((s) => s.is_active)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // ESC：向导内回退一级；列表则回到对话。用 ref 保证始终调用最新的 goBack
  const goBackRef = useRef(() => {})
  useEffect(() => {
    goBackRef.current = goBack
  })
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && goBackRef.current()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  // 卸载时清掉横幅自动消失的定时器
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
    },
    [],
  )

  // 退出向导回到列表；keep=false 时删除「下一步」刚建但还没保存表的悬空源
  const goToList = ({ keep = false } = {}) => {
    if (freshCreated && !keep && currentId) deleteDataSource(currentId).catch(() => {})
    setView('list')
    setNewStep('form')
    setEditing(null)
    setCurrentId(null)
    setFreshCreated(false)
    load()
  }

  const goBack = () => {
    // 删除确认打开时：ESC 先关对话框，不能顺手退出页面
    if (confirmDel) return setConfirmDel(null)
    if (view === 'list') return onBackToChat?.()
    // 「查看表」页只有一级：ESC/返回直接回列表（keep：无悬空源可删）
    if (view === 'tables') return goToList({ keep: true })
    if (newStep === 'tables') return setNewStep('form')
    return goToList()
  }

  const title =
    view === 'edit' ? t('ds.edit') : view === 'new' ? t('ds.new')
      : view === 'tables' ? (editing?.name || t('ds.chooseTables'))
      : t('ds.title')

  const openNew = () => {
    setEditing(null)
    setCurrentId(null)
    setFreshCreated(false)
    setNotice(null)
    setNewStep('form')
    setView('new')
  }
  const openEdit = (s) => {
    setEditing(s)
    setCurrentId(s.id)
    setFreshCreated(false)
    setNotice(null)
    setNewStep('form')
    setView('edit')
  }
  // 卡片「查看表」：直接进入选表/管理步
  // 用独立 view='tables' 而非 'edit'：'edit' 会同时弹出编辑表单 sheet，盖住表管理页
  const openTables = (s) => {
    setEditing(s)
    setCurrentId(s.id)
    setFreshCreated(false)
    setNotice(null)
    setNewStep('tables')
    setView('tables')
  }

  // 表单「下一步」成功（已测试连通 + 已创建/更新源）→ 进入选表步
  const handleFormNext = (id, created) => {
    if (!id) return
    setCurrentId(id)
    setFreshCreated(!!created)
    setNewStep('tables')
  }

  // 编辑 sheet「保存」成功（已测试连通 + 已更新）→ 关闭 sheet 回列表
  const handleSheetSaved = () => goToList({ keep: true })

  // 选表步「保存」成功 → 回列表（保留源）；首个源自动设为使用中
  const handleTablesSaved = () => {
    const cid = currentId
    goToList({ keep: true })
    if (cid && !hadActiveRef.current) setDataSourceActive(cid).catch(() => {})
  }

  // 选表步「取消」→ 回列表（删除未保存的悬空源）
  const handleTablesCancel = () => goToList()

  const remove = (s) => setConfirmDel(s)
  const confirmRemove = () => {
    const s = confirmDel
    setConfirmDel(null)
    if (!s) return
    setBusy(s.id)
    deleteDataSource(s.id)
      .then(() => load())
      .catch((e) => flash(e?.response?.data?.detail || t('ds.deleteFail'), false))
      .finally(() => setBusy(''))
  }

  const doSetActive = (id) => {
    setBusy(id)
    setDataSourceActive(id)
      .then(() => load())
      .catch((e) => flash(e?.response?.data?.detail || t('ds.activeFail'), false))
      .finally(() => setBusy(''))
  }

  // 测试「已保存」的数据源连接（走后端 POST /datasources/{id}/test），结果在页内横幅显示
  const doTest = (id) => {
    setTestingId(id)
    testDataSource(id)
      .then((r) => flash(r?.message || (r?.ok ? t('ds.testOk') : t('ds.testFail')), !!r?.ok))
      .catch((e) => flash(e?.response?.data?.detail || t('ds.testFail'), false))
      .finally(() => setTestingId(''))
  }

  // 面包屑「数据源」段点击：直接回列表（查看表页无悬空源，keep；向导内取消会删未保存源）
  const onCrumbHome = () => (view === 'tables' ? goToList({ keep: true }) : goToList())

  return (
    <div className={`dsrc-page${view === 'edit' || confirmDel ? ' modal-open' : ''}`}>
      {/* 顶栏仅向导视图（面包屑导航 + 类型徽标）；列表视图为无顶栏的页头单行（参考布局） */}
      {view !== 'list' && (
        <header className="dsrc-topbar">
          <nav className="dsrc-crumbs" aria-label="面包屑">
            <button type="button" className="dsrc-crumb-link" onClick={onCrumbHome}>
              <Database className="dsrc-crumb-ico" aria-hidden="true" />
              <span>{t('ds.title')}</span>
            </button>
            <ChevronRight className="dsrc-crumb-sep" aria-hidden="true" />
            <span className="dsrc-crumb-cur">
              {view === 'tables' ? (
                <DbTypeIcon type={editing?.type || 'postgresql'} size={16} className="dsrc-crumb-db" />
              ) : null}
              <span className="dsrc-crumb-cur-name">{title}</span>
            </span>
          </nav>
          <span className="dsrc-topbar-badge">PostgreSQL</span>
        </header>
      )}

      <div className={`dsrc-container${view === 'tables' ? ' is-tables' : ''}`}>
        {notice && (
          <div className={`ds-bannertest${notice.ok ? ' ok' : ''}`} role="status">
            {notice.msg}
          </div>
        )}

        {view === 'list' && (
          <DataSourceList
            sources={sources}
            activeId={activeId}
            busy={busy}
            testing={testingId}
            loading={loading}
            onNew={openNew}
            onEdit={openEdit}
            onViewTables={openTables}
            onAsk={onAsk}
            onSetActive={doSetActive}
            onTest={doTest}
            onRemove={remove}
          />
        )}

        {/* 新建表单：保持挂载、仅隐藏切换，回退再前进不丢已填内容 */}
        {view === 'new' && (
          <div style={{ display: newStep === 'form' ? 'block' : 'none' }}>
            <DataSourceForm
              existingId={currentId}
              onNext={handleFormNext}
              onPrev={goToList}
              onError={(m) => flash(m, false)}
            />
          </div>
        )}

        {/* 编辑：底部弹出的可编辑页（iOS bottom sheet），保存/取消/遮罩点击/ESC 均回列表 */}
        {view === 'edit' && editing && (
          <div className="ds-sheet-overlay" onClick={() => goToList()}>
            <div
              className="ds-sheet"
              role="dialog"
              aria-modal="true"
              aria-label={`${t('ds.edit')} · ${editing.name}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="ds-sheet-grab" aria-hidden="true" />
              <div className="ds-sheet-head">
                <h3 className="ds-sheet-title">
                  {t('ds.edit')} · {editing.name}
                </h3>
                <button type="button" className="ds-sheet-close" onClick={() => goToList()} aria-label={t('ds.cancel')}>
                  <X />
                </button>
              </div>
              <div className="ds-sheet-body">
                <DataSourceForm
                  editing={editing}
                  existingId={editing.id}
                  onNext={handleSheetSaved}
                  onError={(m) => flash(m, false)}
                />
              </div>
            </div>
          </div>
        )}

        {(view === 'new' || view === 'edit' || view === 'tables') && currentId && (
          <div
            style={{ display: newStep === 'tables' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}
          >
            <TableSelectStep
              sourceId={currentId}
              onSaved={handleTablesSaved}
              onCancel={handleTablesCancel}
              // 「查看表」页只有一级：返回 = 回列表；向导内：返回 = 上一步（连接表单）
              onPrev={view === 'tables' ? () => goToList({ keep: true }) : () => setNewStep('form')}
              backLabel={view === 'tables' ? t('ds.backTo') : undefined}
              onError={(m) => flash(m, false)}
            />
          </div>
        )}

        {/* 删除确认：iOS 系统对话框（取代 window.confirm） */}
        {confirmDel && (
          <div className="ds-dialog-overlay" onClick={() => setConfirmDel(null)}>
            <div
              className="ds-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-label={t('ds.confirmDelete', { name: confirmDel.name })}
              onClick={(e) => e.stopPropagation()}
            >
              <h4>{confirmDel.name}</h4>
              <p>{t('ds.confirmDelete', { name: confirmDel.name })}</p>
              <div className="ds-dialog-actions">
                <button type="button" onClick={() => setConfirmDel(null)}>
                  {t('ds.cancel')}
                </button>
                <button type="button" className="danger" onClick={confirmRemove}>
                  {t('ds.delete')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
