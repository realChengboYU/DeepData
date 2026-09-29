import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleCheck, LayoutGrid, Loader2, Pencil, Search, Table, X } from 'lucide-react'
import { useI18n } from '../../i18n'
import { getCuratedTables, introspectFields, introspectPreview, introspectTables, saveCuratedTables } from '../../api'
import './tables.css'

// 第 3 步：选择表（左表清单 + 右字段/注释/预览）
export default function TableSelectStep({ sourceId, onSaved, onCancel, onPrev, backLabel, onError }) {
  const { t } = useI18n()
  // 每张表带 fields:[{field_name, field_type, checked, custom_comment, enum_values}]
  const [tables, setTables] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [active, setActive] = useState('')
  const [fieldsLoading, setFieldsLoading] = useState(false)
  const [preview, setPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  // 右面板视图：struct 表结构 | preview 数据预览；fieldKw 为表内字段搜索
  const [view, setView] = useState('struct')
  const [fieldKw, setFieldKw] = useState('')
  // 左栏清单搜索（仅过滤已勾选的表）
  const [sidebarKw, setSidebarKw] = useState('')
  // 表结构分页（10 条/页）
  const PAGE_SIZE = 10
  const [structPage, setStructPage] = useState(0)
  // 「勾选表」底部弹出 sheet：点开后上滑覆盖选表步；左栏只显示已勾选的表
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickSearch, setPickSearch] = useState('')
  const [sheetShown, setSheetShown] = useState(false)
  const [sheetClosing, setSheetClosing] = useState(false)
  const closeTimer = useRef(null)
  const tablesRef = useRef([])
  useEffect(() => {
    tablesRef.current = tables
  }, [tables])

  // 打开后下一帧加 open 类，触发上滑过渡
  useEffect(() => {
    if (!pickerOpen) {
      setSheetShown(false)
      return
    }
    const id = requestAnimationFrame(() => setSheetShown(true))
    return () => cancelAnimationFrame(id)
  }, [pickerOpen])

  const closeSheet = () => {
    if (sheetClosing) return
    setSheetClosing(true)
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => {
      setPickerOpen(false)
      setSheetClosing(false)
    }, 240)
  }
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    },
    [],
  )

  // sheet 打开时：ESC 先收起 sheet（capture 阶段拦截，不触发页面级 ESC 回退）
  useEffect(() => {
    if (!pickerOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeSheet()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerOpen, sheetClosing])

  // 载入目标库的表 + 已策展状态（勾选/注释/字段）
  useEffect(() => {
    let live = true
    setLoading(true)
    setLoadErr('')
    setTables([])
    setActive('')
    setPreview(null)
    setPickerOpen(false)
    setSheetClosing(false)
    setPickSearch('')
    const curP = getCuratedTables(sourceId).catch(() => ({ tables: [] }))
    introspectTables(sourceId)
      .then(async (d) => {
        const cd = await curP
        if (!live) return
        const curatedMap = {}
        for (const ct of cd?.tables ?? []) curatedMap[ct.table_name] = ct
        const list = (d?.tables ?? []).map((x) => {
          const cur = curatedMap[x.table_name]
          return {
            table_name: x.table_name,
            table_comment: x.table_comment || '',
            custom_comment: cur?.custom_comment || '',
            checked: cur ? cur.checked : true,
            fields: cur?.fields ?? [],
          }
        })
        setTables(list)
        if (list.length) setActive(list[0].table_name)
      })
      .catch((e) => {
        if (live) setLoadErr(e?.response?.data?.detail || t('ds.tablesReadFail'))
      })
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId])

  // 切换到某张表 → 载入其字段（live 字段 + 已有勾选/注释/枚举 状态合并）
  useEffect(() => {
    if (!active) return
    let live = true
    setFieldsLoading(true)
    setPreview(null)
    introspectFields(sourceId, active)
      .then((d) => {
        if (!live) return
        const liveFields = d?.fields ?? []
        const prev = tablesRef.current.find((x) => x.table_name === active)?.fields ?? []
        const prevMap = {}
        for (const p of prev) prevMap[p.field_name] = p
        const merged = liveFields.map((f) => {
          const p = prevMap[f.field_name]
          return {
            field_name: f.field_name,
            field_type: f.field_type || '',
            checked: p ? p.checked : true,
            custom_comment: p?.custom_comment || '',
            enum_values: p?.enum_values || '',
          }
        })
        setTables((ts) => ts.map((x) => (x.table_name === active ? { ...x, fields: merged } : x)))
      })
      .catch(() => {})
      .finally(() => {
        if (live) {
          setFieldsLoading(false)
          setStructPage(0)
        }
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, sourceId])

  // 字段搜索变化时回到第一页
  useEffect(() => {
    setStructPage(0)
  }, [fieldKw])

  // 左栏只显示已勾选的表（按表名排序）；勾选面板列出全部表（带搜索）
  const checkedListRaw = tables.filter((x) => x.checked)
  const checkedList = [...checkedListRaw].sort((a, b) => a.table_name.localeCompare(b.table_name))
  // 左栏清单按 表名/注释 搜索过滤
  const skw = sidebarKw.trim().toLowerCase()
  const sidebarFiltered = skw
    ? checkedList.filter(
        (x) => x.table_name.toLowerCase().includes(skw) || (x.table_comment || '').toLowerCase().includes(skw),
      )
    : checkedList
  const pickKw = pickSearch.trim().toLowerCase()
  const pickFiltered = pickKw ? tables.filter((x) => x.table_name.toLowerCase().includes(pickKw)) : tables
  const checkedCount = tables.filter((x) => x.checked).length
  const allChecked = tables.length > 0 && checkedCount === tables.length
  const activeRow = tables.find((x) => x.table_name === active)
  // 字段搜索过滤（仅作用于当前活动表的表结构视图）
  const fk = fieldKw.trim().toLowerCase()
  const visibleFields = fk
    ? (activeRow?.fields ?? []).filter((f) => f.field_name.toLowerCase().includes(fk))
    : (activeRow?.fields ?? [])
  // 表结构分页：10 条/页（搜索过滤后分页，页码越界时钳回最后一页）
  const structTotal = Math.max(1, Math.ceil(visibleFields.length / PAGE_SIZE))
  const safePage = Math.min(structPage, structTotal - 1)
  const pageFields = visibleFields.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  const setChecked = (name, val) => setTables((ts) => ts.map((x) => (x.table_name === name ? { ...x, checked: val } : x)))
  const setComment = (name, val) => setTables((ts) => ts.map((x) => (x.table_name === name ? { ...x, custom_comment: val } : x)))
  const setAll = (val) => setTables((ts) => ts.map((x) => ({ ...x, checked: val })))
  // 更新活动表某字段的 勾选 / 注释 / 枚举
  const setField = (tableName, fieldName, key, val) =>
    setTables((ts) =>
      ts.map((x) =>
        x.table_name === tableName
          ? { ...x, fields: (x.fields || []).map((f) => (f.field_name === fieldName ? { ...f, [key]: val } : f)) }
          : x,
      ),
    )

  async function doPreview() {
    if (!active || previewLoading) return
    setPreviewLoading(true)
    setPreview(null)
    try {
      setPreview(await introspectPreview(sourceId, active, 10))
    } catch (e) {
      onError?.(e?.response?.data?.detail || t('ds.tablesReadFail'))
    } finally {
      setPreviewLoading(false)
    }
  }

  // 页签切换：数据预览懒加载（首次切入才请求）
  const openStruct = () => setView('struct')
  const openPreview = () => {
    setView('preview')
    if (!preview && !previewLoading) doPreview()
  }

  async function save() {
    if (saving || !tables.length) return
    setSaving(true)
    try {
      await saveCuratedTables(sourceId, tables)
      onSaved()
    } catch (e) {
      onError?.(e?.response?.data?.detail || t('ds.saveFail'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="dsrc-flow dsrc-flow-tables">
      {loadErr ? (
        <div className="ds-test err" role="alert">
          <X />
          <span>{loadErr}</span>
        </div>
      ) : (
        <div className="dsrc-tables">
          {/* 左：已勾选的表（右上角按钮打开「勾选表」面板管理全部表） */}
          <div className="dsrc-tables-left">
            <div className="dsrc-tables-title">
              <span>{t('ds.tablesTitle')}</span>
              <div className="dsrc-tables-title-tools">
                <button
                  type="button"
                  className="dsrc-pick-btn"
                  title={t('ds.pickTables')}
                  aria-label={t('ds.pickTables')}
                  onClick={() => setPickerOpen(true)}
                >
                  <LayoutGrid />
                </button>
              </div>
            </div>
            <label className="dsrc-list-search">
              <Search />
              <input
                value={sidebarKw}
                placeholder={t('ds.searchTables')}
                onChange={(e) => setSidebarKw(e.target.value)}
              />
            </label>
            <div className="dsrc-tables-count">
              <span>{t('ds.selectedCount', { n: checkedCount, total: tables.length })}</span>
            </div>
            {loading ? (
              <div className="dsrc-tables-state">
                <Loader2 className="spin" /> {t('ds.tablesLoading')}
              </div>
            ) : tables.length === 0 ? (
              <div className="dsrc-tables-state">{t('ds.tablesEmpty')}</div>
            ) : checkedList.length === 0 ? (
              <div className="dsrc-tables-state">{t('ds.noChecked')}</div>
            ) : sidebarFiltered.length === 0 ? (
              <div className="dsrc-tables-state">{t('ds.noTableMatch')}</div>
            ) : (
              <ul className="dsrc-tables-list">
                {sidebarFiltered.map((x) => (
                  <li
                    key={x.table_name}
                    className={`dsrc-table${active === x.table_name ? ' active' : ''}`}
                    onClick={() => { setActive(x.table_name); setView('struct') }}
                  >
                    <Table className="dsrc-table-icon" aria-hidden="true" />
                    <span className="dsrc-table-name">{x.table_name}</span>
                    {x.custom_comment && <Pencil className="dsrc-table-note" aria-hidden="true" />}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 右：字段 / 注释 / 预览 */}
          <div className="dsrc-tables-right">
            {!active ? (
              <div className="dsrc-tables-state">{t('ds.noActiveTable')}</div>
            ) : (
              <>
                <div className="dsrc-ds-name">
                  <span className="dsrc-ds-title">{active}</span>
                  {activeRow?.table_comment && (
                    <span className="dsrc-ds-comment" title={t('ds.tableComment')}>
                      <Pencil aria-hidden="true" />
                      <span>{t('ds.commentLabel')}：{activeRow.table_comment}</span>
                    </span>
                  )}
                </div>

                <div className="ds-field">
                  <label htmlFor="ds-custom-comment">{t('ds.customComment')}</label>
                  <textarea
                    id="ds-custom-comment"
                    className="ds-input ds-input-area"
                    rows={2}
                    value={activeRow?.custom_comment || ''}
                    placeholder={t('ds.customCommentPh')}
                    onChange={(e) => setComment(active, e.target.value)}
                  />
                </div>

                <div className="dsrc-viewrow">
                  <div className="dsrc-tabs" role="tablist" aria-label={t('ds.fields')}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={view === 'struct'}
                      className={`dsrc-tab${view === 'struct' ? ' on' : ''}`}
                      onClick={openStruct}
                    >
                      {t('ds.tabStruct')}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={view === 'preview'}
                      className={`dsrc-tab${view === 'preview' ? ' on' : ''}`}
                      onClick={openPreview}
                    >
                      {t('ds.tabPreview')}
                    </button>
                  </div>
                  {view === 'struct' && (
                    <label className="dsrc-fields-search">
                      <Search />
                      <input value={fieldKw} placeholder={t('ds.searchFields')} onChange={(e) => setFieldKw(e.target.value)} />
                    </label>
                  )}
                </div>

                {view === 'preview' ? (
                  previewLoading ? (
                    <div className="dsrc-tables-state">
                      <Loader2 className="spin" /> {t('ds.previewLoading')}
                    </div>
                  ) : preview && preview.columns.length ? (
                    <div className="dsrc-preview">
                      <table className="dsrc-preview-table">
                        <thead>
                          <tr>
                            {preview.columns.map((c) => (
                              <th key={c}>{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.rows.map((r, i) => (
                            <tr key={i}>
                              {r.map((v, j) => (
                                <td key={j}>{v == null ? '' : String(v)}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {preview.rows.length === 0 && <div className="dsrc-tables-state">{t('ds.previewEmpty')}</div>}
                    </div>
                  ) : (
                    <div className="dsrc-tables-state">{t('ds.previewEmpty')}</div>
                  )
                ) : fieldsLoading ? (
                  <div className="dsrc-tables-state">
                    <Loader2 className="spin" />
                  </div>
                ) : (activeRow?.fields || []).length ? (
                  <>
                    <div className="dsrc-struct-wrap">
                      <table className="dsrc-struct">
                        <thead>
                          <tr>
                            <th>{t('ds.colName')}</th>
                            <th>{t('ds.colType')}</th>
                            <th>{t('ds.colComment')}</th>
                            <th>{t('ds.fieldEnum')}</th>
                            <th className="dsrc-struct-on">{t('ds.colEnabled')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pageFields.map((f) => (
                            <tr key={f.field_name} className={f.checked ? '' : 'off'}>
                              <td>
                                <code className="dsrc-struct-name">{f.field_name}</code>
                              </td>
                              <td>
                                <span className="dsrc-struct-type">{f.field_type}</span>
                              </td>
                              <td>
                                <input
                                  className="ds-input ds-input-sm"
                                  placeholder={t('ds.fieldCommentPh')}
                                  value={f.custom_comment}
                                  disabled={!f.checked}
                                  onChange={(e) => setField(active, f.field_name, 'custom_comment', e.target.value)}
                                />
                              </td>
                              <td>
                                <input
                                  className="ds-input ds-input-sm"
                                  placeholder={t('ds.fieldEnumPh')}
                                  value={f.enum_values}
                                  disabled={!f.checked}
                                  onChange={(e) => setField(active, f.field_name, 'enum_values', e.target.value)}
                                />
                              </td>
                              <td className="dsrc-struct-on">
                                <label className="ds-switch">
                                  <input
                                    type="checkbox"
                                    checked={f.checked}
                                    aria-label={`${f.field_name} ${t('ds.colEnabled')}`}
                                    onChange={(e) => setField(active, f.field_name, 'checked', e.target.checked)}
                                  />
                                  <span className="ds-switch-track" aria-hidden="true" />
                                </label>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="dsrc-struct-pager">
                      <span className="dsrc-struct-foot">
                        {t('ds.fieldChecked', {
                          n: (activeRow?.fields || []).filter((f) => f.checked).length,
                          total: (activeRow?.fields || []).length,
                        })}
                      </span>
                      {visibleFields.length > PAGE_SIZE && (
                        <div className="dsrc-pager">
                          <button
                            type="button"
                            className="dsrc-pager-btn"
                            disabled={safePage === 0}
                            onClick={() => setStructPage(safePage - 1)}
                          >
                            {t('ds.prevPage')}
                          </button>
                          <span className="dsrc-pager-ind">
                            {safePage + 1} / {structTotal}
                          </span>
                          <button
                            type="button"
                            className="dsrc-pager-btn"
                            disabled={safePage >= structTotal - 1}
                            onClick={() => setStructPage(safePage + 1)}
                          >
                            {t('ds.nextPage')}
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="dsrc-tables-state">{fk ? t('ds.noFieldMatch') : t('ds.tablesEmpty')}</div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div className="ds-form-actions">
        {/* 独立「查看表」视图：返回与取消同义（都回列表），只保留取消；向导内才显示「上一步」 */}
        {!backLabel && (
          <button type="button" className="ds-btn ds-btn-ghost" disabled={saving} onClick={onPrev}>
            ← {t('ds.prev')}
          </button>
        )}
        <button type="button" className="ds-btn ds-btn-ghost" disabled={saving} onClick={onCancel}>
          {t('ds.cancel')}
        </button>
        <button
          type="button"
          className="ds-btn ds-btn-primary"
          disabled={loading || saving || !tables.length}
          onClick={save}
        >
          {saving ? <Loader2 className="spin" /> : <CircleCheck />} {t('ds.save')}
        </button>
      </div>

      {/* 「勾选表」底部弹出 sheet：portal 到 body，用 fixed 视口锚定，不依赖父级高度链/定位祖先 */}
      {pickerOpen &&
        createPortal(
          <>
            <div
              className={`dsrc-sheet-scrim${sheetShown && !sheetClosing ? ' open' : ''}${sheetClosing ? ' closing' : ''}`}
              onClick={closeSheet}
              aria-hidden="true"
            />
          <div
            className={`dsrc-sheet${sheetShown && !sheetClosing ? ' open' : ''}${sheetClosing ? ' closing' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={t('ds.pickTables')}
          >
            <div className="dsrc-sheet-grip" aria-hidden="true" />
            <div className="dsrc-sheet-head">
              <h2 className="dsrc-sheet-title">
                {t('ds.pickTables')}
                <span className="dsrc-sheet-count">({checkedCount} / {tables.length})</span>
              </h2>
              <label className="dsrc-sheet-search">
                <Search />
                <input
                  value={pickSearch}
                  placeholder={t('ds.searchTables')}
                  autoFocus
                  onChange={(e) => setPickSearch(e.target.value)}
                />
              </label>
            </div>
            <div className="dsrc-sheet-body">
              <label className="dsrc-sheet-all">
                <input type="checkbox" checked={allChecked} onChange={(e) => setAll(e.target.checked)} />
                <span>{t('ds.selectAll')}</span>
              </label>
              <div className="dsrc-sheet-list">
                {tables.length === 0 ? (
                  <div className="dsrc-tables-state">{t('ds.tablesEmpty')}</div>
                ) : pickFiltered.length === 0 ? (
                  <div className="dsrc-tables-state">{t('ds.noTableMatch')}</div>
                ) : (
                  pickFiltered.map((x) => (
                    <label key={x.table_name} className={`dsrc-sheet-row${x.checked ? ' on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={x.checked}
                        onChange={(e) => setChecked(x.table_name, e.target.checked)}
                      />
                      <Table className="dsrc-sheet-row-icon" aria-hidden="true" />
                      <span className="dsrc-table-name">{x.table_name}</span>
                      {x.table_comment && <span className="dsrc-sheet-row-cmt">{x.table_comment}</span>}
                    </label>
                  ))
                )}
              </div>
            </div>
            <div className="dsrc-sheet-foot">
              <button type="button" className="ds-btn ds-btn-ghost" onClick={closeSheet}>
                {t('ds.cancel')}
              </button>
              <button
                type="button"
                className="ds-btn ds-btn-primary"
                disabled={loading || saving || !tables.length}
                onClick={save}
              >
                {saving ? <Loader2 className="spin" /> : <CircleCheck />} {t('ds.save')}
              </button>
            </div>
          </div>
          </>
        ,
        document.body
      )}
    </div>
  )
}
