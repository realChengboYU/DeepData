import { useState } from 'react'
import { ChevronDown, CircleCheck, Eye, EyeOff, Loader2, X, Zap } from 'lucide-react'
import { useI18n } from '../../i18n'
import { createDataSource, introspectSchemasRaw, testDataSourceRaw, updateDataSource } from '../../api'
import { DB_TYPES, DbTypeIcon } from './DbTypeIcon'
import './form.css'

// 连接串预览（镜像后端 build_pg_url 的结构，密码打码）
function connPreview(host, port, dbname, username, hasPassword, hasSsl) {
  const h = host || '主机'
  const p = port || '5432'
  const db = dbname || '数据库'
  const u = username || '用户名'
  const pw = hasPassword ? '••••••••' : '······'
  const ssl = hasSsl ? '?sslmode=require' : ''
  return `postgresql+psycopg://${u}:${pw}@${h}:${p}/${db}${ssl}`
}

const EMPTY = {
  name: '', host: '', port: 5432, dbname: '', username: '', password: '', description: '',
  schema: 'public', timeout: 6, pool_size: 5, ssl: false,
}

// 配置连接（新建 / 编辑）——类型选择已并入首组；「下一步」先测试连通，再创建/更新数据源并进入选表步
export default function DataSourceForm({ editing, existingId, onNext, onPrev, onError }) {
  const { t } = useI18n()
  const isEdit = !!editing
  const targetId = isEdit ? editing.id : existingId
  const [form, setForm] = useState(() =>
    isEdit
      ? {
          name: editing.name || '',
          host: editing.host || '',
          port: editing.port || 5432,
          dbname: editing.dbname || '',
          username: editing.username || '',
          password: '',
          description: editing.description || '',
          schema: editing.schema || 'public',
          timeout: editing.timeout || 6,
          pool_size: editing.pool_size || 5,
          ssl: !!editing.ssl,
        }
      : EMPTY,
  )
  const [showPwd, setShowPwd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [showAdv, setShowAdv] = useState(isEdit) // 高级选项：新建默认收起
  const [schemaList, setSchemaList] = useState([])
  const [fetchingSchema, setFetchingSchema] = useState(false)

  // 「获取 Schema」：按当前连接信息列出库内 schema
  async function fetchSchemas() {
    if (fetchingSchema) return
    setFetchingSchema(true)
    try {
      const r = await introspectSchemasRaw({
        host: form.host.trim(),
        port: Number(form.port) || 5432,
        dbname: form.dbname.trim(),
        username: form.username.trim(),
        password: form.password,
        ssl: form.ssl,
      })
      setSchemaList(r?.schemas ?? [])
    } catch (e) {
      setSchemaList([])
      onError?.(e?.response?.data?.detail || t('ds.tablesReadFail'))
    } finally {
      setFetchingSchema(false)
    }
  }

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }))
    if (k !== 'password') setTestResult(null)
  }
  const canSave = form.name.trim() && form.host.trim() && form.dbname.trim() && form.username.trim()

  const rawConn = () => ({
    host: form.host.trim(),
    port: Number(form.port) || 5432,
    dbname: form.dbname.trim(),
    username: form.username.trim(),
    password: form.password,
    schema: form.schema.trim() || 'public',
    ssl: !!form.ssl,
  })

  async function doTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await testDataSourceRaw(rawConn())
      setTestResult(r)
    } catch (e) {
      setTestResult({ ok: false, message: e?.response?.data?.detail || t('ds.testFail') })
    } finally {
      setTesting(false)
    }
  }

  // 下一步：先测试连通（gating），通过后创建/更新数据源并进入选表步
  async function next() {
    if (!canSave || saving) return
    setSaving(true)
    setTestResult(null)
    try {
      const tr = await testDataSourceRaw(rawConn())
      if (!tr?.ok) {
        setTestResult(tr || { ok: false, message: t('ds.testFail') })
        return
      }
      const payload = {
        name: form.name.trim(),
        host: form.host.trim(),
        port: Number(form.port) || 5432,
        dbname: form.dbname.trim(),
        username: form.username.trim(),
        description: form.description || '',
        schema: form.schema.trim() || 'public',
        timeout: Number(form.timeout) || 6,
        pool_size: Number(form.pool_size) || 5,
        ssl: !!form.ssl,
      }
      if (targetId) {
        if (form.password) payload.password = form.password
        await updateDataSource(targetId, payload)
        onNext(targetId, false)
      } else {
        payload.password = form.password || ''
        const r = await createDataSource(payload)
        onNext(r?.id, true)
      }
    } catch (e) {
      const detail = e?.response?.data?.detail
      setTestResult({ ok: false, message: detail || t('ds.saveFail') })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="dsrc-flow">
      <div className="dsrc-flow-head">
        <h3 className="dsrc-flow-title">
          {t('ds.configure')} <span className="dsrc-flow-badge">PostgreSQL</span>
        </h3>
        <p className="dsrc-flow-sub">{t('ds.chooseTypeSub')}</p>
      </div>

      {/* 组 1：数据库类型（当前仅 PostgreSQL 可用，其余占位） */}
      <div className="ds-group">
        <div className="ds-group-head">{t('ds.chooseType')}</div>
        <div className="ds-group-body">
          <div className="dsrc-types compact" role="radiogroup" aria-label={t('ds.chooseType')}>
            {DB_TYPES.map((tp) => (
              <button
                key={tp.id}
                type="button"
                role="radio"
                aria-checked={tp.available}
                disabled={!tp.available}
                className={`dsrc-type${tp.available ? ' selected' : ''}`}
              >
                <span className={`dsrc-type-glyph${tp.available ? '' : ' soon'}`} aria-hidden="true">
                  <DbTypeIcon type={tp.id} size={24} />
                </span>
                <span className="dsrc-type-body">
                  <span className="dsrc-type-name">{tp.name}</span>
                </span>
                <span className={`dsrc-type-status${tp.available ? '' : ' soon'}`}>
                  {tp.available ? t('ds.available') : t('ds.comingSoon')}
                </span>
                {tp.available && (
                  <span className="dsrc-type-check" aria-hidden="true">
                    <CircleCheck />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 组 2：基本信息 */}
      <div className="ds-group">
        <div className="ds-group-head">{t('ds.groupBasic')}</div>
        <div className="ds-field">
          <label htmlFor="ds-name">{t('ds.name')}</label>
        <input
          id="ds-name"
          className="ds-input"
          value={form.name}
          placeholder="订单库"
          autoComplete="off"
          autoFocus={isEdit}
          onChange={(e) => set('name', e.target.value)}
        />
        </div>
      </div>

      {/* 组 3：连接信息 */}
      <div className="ds-group">
        <div className="ds-group-head">{t('ds.groupConn')}</div>
        <div className="ds-row2">
        <div className="ds-field ds-field-grow">
          <label htmlFor="ds-host">{t('ds.host')}</label>
          <input
            id="ds-host"
            className="ds-input"
            value={form.host}
            placeholder="10.0.0.5 / 主机名"
            autoComplete="off"
            onChange={(e) => set('host', e.target.value)}
          />
        </div>
        <div className="ds-field ds-field-port">
          <label htmlFor="ds-port">{t('ds.port')}</label>
          <input
            id="ds-port"
            className="ds-input"
            type="number"
            min="1"
            max="65535"
            value={form.port}
            onChange={(e) => set('port', e.target.value)}
          />
        </div>
      </div>

      <div className="ds-field">
        <label htmlFor="ds-db">{t('ds.database')}</label>
        <input
          id="ds-db"
          className="ds-input"
          value={form.dbname}
          placeholder="order_db"
          autoComplete="off"
          onChange={(e) => set('dbname', e.target.value)}
        />
      </div>

      <div className="ds-field">
        <label htmlFor="ds-schema">{t('ds.schema')}</label>
        <div className="ds-schema-row">
          <input
            id="ds-schema"
            className="ds-input ds-input-mono"
            value={form.schema}
            placeholder="public"
            autoComplete="off"
            onChange={(e) => set('schema', e.target.value)}
          />
          <button
            type="button"
            className="ds-btn ds-btn-ghost ds-btn-sm"
            disabled={fetchingSchema || !form.host.trim() || !form.dbname.trim() || !form.username.trim()}
            onClick={fetchSchemas}
          >
            {fetchingSchema ? <Loader2 className="spin" /> : <Zap />}
            {fetchingSchema ? t('ds.fetching') : t('ds.fetchSchemas')}
          </button>
        </div>
        {schemaList.length > 0 && (
          <div className="ds-schema-chips">
            {schemaList.map((s) => (
              <button
                key={s}
                type="button"
                className={`ds-schema-chip${s === form.schema ? ' on' : ''}`}
                onClick={() => set('schema', s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <span className="ds-hint">{t('ds.schemaHint')}</span>
      </div>

      <div className="ds-field">
        <label htmlFor="ds-user">{t('ds.username')}</label>
        <input
          id="ds-user"
          className="ds-input ds-input-mono"
          value={form.username}
          placeholder="postgres"
          autoComplete="off"
          onChange={(e) => set('username', e.target.value)}
        />
      </div>

      <div className="ds-field">
        <label htmlFor="ds-pwd">{t('ds.password')}</label>
        <div className="ds-pwd-wrap">
          <input
            id="ds-pwd"
            className="ds-input"
            type={showPwd ? 'text' : 'password'}
            value={form.password}
            placeholder={isEdit ? t('ds.passwordKeep') : t('ds.password')}
            autoComplete="new-password"
            onChange={(e) => set('password', e.target.value)}
          />
          <button
            type="button"
            className="ds-pwd-toggle"
            aria-label={showPwd ? '隐藏密码' : '显示密码'}
            onClick={() => setShowPwd((s) => !s)}
          >
            {showPwd ? <EyeOff /> : <Eye />}
          </button>
        </div>
        {isEdit && !form.password && <span className="ds-hint">{t('ds.passwordKeepHint')}</span>}
      </div>
      </div>

      {/* 连接串预览——随输入实时拼出（密码打码），本页唯一的重元素 */}
      <div className="ds-conn" aria-live="polite">
        <div className="ds-conn-label">{t('ds.connString')}</div>
        <code className="ds-conn-code">{connPreview(form.host, form.port, form.dbname, form.username, !!form.password, !!form.ssl)}</code>
      </div>

      {/* 高级选项：超时 / 连接池 / SSL（新建默认收起）*/}
      <div className="ds-adv">
        <button type="button" className="ds-adv-toggle" onClick={() => setShowAdv((s) => !s)}>
          <ChevronDown className={`ds-adv-caret${showAdv ? ' open' : ''}`} aria-hidden="true" /> {t('ds.advanced')}
        </button>
        {showAdv && (
          <div className="ds-adv-body">
            <div className="ds-row2">
              <div className="ds-field ds-field-grow">
                <label htmlFor="ds-timeout">{t('ds.timeout')}</label>
                <input
                  id="ds-timeout"
                  className="ds-input"
                  type="number"
                  min="1"
                  max="300"
                  value={form.timeout}
                  onChange={(e) => set('timeout', e.target.value)}
                />
              </div>
              <div className="ds-field ds-field-grow">
                <label htmlFor="ds-pool">{t('ds.poolSize')}</label>
                <input
                  id="ds-pool"
                  className="ds-input"
                  type="number"
                  min="1"
                  max="500"
                  value={form.pool_size}
                  onChange={(e) => set('pool_size', e.target.value)}
                />
              </div>
            </div>
            <label className="ds-adv-ssl">
              <input
                type="checkbox"
                checked={!!form.ssl}
                onChange={(e) => set('ssl', e.target.checked)}
              />
              {t('ds.ssl')}
            </label>
          </div>
        )}
      </div>

      {testResult && (
        <div className={`ds-test ${testResult.ok ? 'ok' : 'err'}`} role="status">
          {testResult.ok ? <CircleCheck /> : <X />}
          <span>{testResult.message}</span>
        </div>
      )}

      <div className="ds-form-actions">
        {!isEdit && (
          <button type="button" className="ds-btn ds-btn-ghost" disabled={saving} onClick={onPrev}>
            ← {t('ds.backTo')}
          </button>
        )}
        <button
          type="button"
          className="ds-btn ds-btn-ghost"
          disabled={!canSave || testing || saving}
          onClick={doTest}
        >
          {testing ? <Loader2 className="spin" /> : <Zap />}
          {t('ds.test')}
        </button>
        <button type="button" className="ds-btn ds-btn-primary" disabled={!canSave || saving} onClick={next}>
          {saving ? <Loader2 className="spin" /> : null}
          {isEdit ? t('ds.save') : `${t('ds.next')} →`}
        </button>
      </div>
    </div>
  )
}
