import { useEffect, useState } from 'react'
import { Cable, Check, Globe, Loader2, Plus, X } from 'lucide-react'
import { LANGS, LANG_LABELS, useI18n } from '../../i18n'
import { useModelsStore } from '../../store/models'
import { testLlmConfig, createLlmModel, updateLlmModel, deleteLlmModel, setLlmModelDefault } from '../../api'
import './settings.css'

// 设置弹窗：左侧选择「模型配置 / 语言」，右侧显示对应的页面。
// 面板为固定尺寸（不随页签 / 内容变化而伸缩），内部区域独立滚动。
export default function SettingsModal({ open, onClose }) {
  const { lang, setLang, t } = useI18n()
  const [tab, setTab] = useState('model') // 'model' 模型配置 | 'lang' 语言

  // 模型列表与选中态走全局 store：设置里的增删改会同步到聊天输入框的模型选择器
  const models = useModelsStore((s) => s.models)
  const modelsLoaded = useModelsStore((s) => s.loaded)
  const loadModels = useModelsStore((s) => s.load)

  // 模型编辑器：null = 列表视图；{ id: null } = 新建；{ id } = 编辑
  const [editing, setEditing] = useState(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [saving, setSaving] = useState(false)

  // 打开时回到「模型配置」页并刷新模型列表；重置一次性状态
  useEffect(() => {
    if (!open) return
    setTab('model')
    setEditing(null)
    setTestResult(null)
    loadModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const startCreate = () => {
    setTestResult(null)
    setEditing({ id: null, name: '', base_url: '', model: '', api_key: '' })
  }

  const startEdit = (m) => {
    setTestResult(null)
    setEditing({ id: m.id, name: m.name, base_url: m.base_url, model: m.model, api_key: '', hasKey: m.has_key })
  }

  const cancelEdit = () => {
    setEditing(null)
    setTestResult(null)
  }

  const doTest = () => {
    if (!editing) return
    setTesting(true)
    setTestResult(null)
    testLlmConfig({ base_url: editing.base_url, model: editing.model, api_key: editing.api_key })
      .then((r) => setTestResult({ ok: !!r?.ok, msg: r?.message || '' }))
      .catch((e) => setTestResult({ ok: false, msg: e?.response?.data?.message || String(e) }))
      .finally(() => setTesting(false))
  }

  const doSave = () => {
    if (!editing) return
    setSaving(true)
    const payload = {
      name: editing.name,
      base_url: editing.base_url,
      model: editing.model,
      api_key: editing.api_key,
    }
    const req = editing.id ? updateLlmModel(editing.id, payload) : createLlmModel(payload)
    req
      .then(() => loadModels())
      .catch(() => {})
      .finally(() => {
        setSaving(false)
        cancelEdit()
      })
  }

  const doDelete = (m) => {
    if (!window.confirm(t('settings.delModelConfirm', { name: m.name }))) return
    deleteLlmModel(m.id).then(() => loadModels()).catch(() => {})
  }

  const doSetDefault = (m) => {
    setLlmModelDefault(m.id).then(() => loadModels()).catch(() => {})
  }

  return (
    <div
      className="settings-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="settings-panel" role="dialog" aria-modal="true" aria-label={t('settings')}>
        <header className="settings-head">
          <span className="settings-title">{t('settings')}</span>
          <button type="button" className="settings-close" onClick={onClose} aria-label={t('close')}>
            <X />
          </button>
        </header>

        <div className="settings-body">
          <nav className="settings-nav" aria-label={t('settings')}>
            <button
              type="button"
              className={`settings-nav-item${tab === 'model' ? ' active' : ''}`}
              aria-current={tab === 'model' ? 'page' : undefined}
              onClick={() => setTab('model')}
            >
              <Cable className="settings-nav-icon" />
              <span>{t('settings.model')}</span>
            </button>
            <button
              type="button"
              className={`settings-nav-item${tab === 'lang' ? ' active' : ''}`}
              aria-current={tab === 'lang' ? 'page' : undefined}
              onClick={() => setTab('lang')}
            >
              <Globe className="settings-nav-icon" />
              <span>{t('language')}</span>
            </button>
          </nav>

          <div className="settings-pane">
            {tab === 'model' ? (
              <section className="settings-section">
                <div className="settings-section-title">{t('settings.model')}</div>
                <p className="settings-section-sub">{t('settings.modelSub')}</p>

                {editing ? (
                  <div className="model-editor">
                    <div className="settings-field">
                      <label className="settings-field-label" htmlFor="set-model-name">
                        {t('settings.modelTitle')}
                      </label>
                      <input
                        id="set-model-name"
                        className="settings-input"
                        type="text"
                        value={editing.name}
                        onChange={(e) => setEditing((s) => ({ ...s, name: e.target.value }))}
                        placeholder={t('settings.modelTitlePh')}
                        spellCheck={false}
                        autoComplete="off"
                      />
                    </div>
                    <div className="settings-field">
                      <label className="settings-field-label" htmlFor="set-baseurl">
                        {t('settings.baseUrl')}
                      </label>
                      <input
                        id="set-baseurl"
                        className="settings-input mono"
                        type="text"
                        value={editing.base_url}
                        onChange={(e) => setEditing((s) => ({ ...s, base_url: e.target.value }))}
                        placeholder="http://host:port/v1"
                        spellCheck={false}
                        autoComplete="off"
                      />
                    </div>
                    <div className="settings-field">
                      <label className="settings-field-label" htmlFor="set-model">
                        {t('settings.modelName')}
                      </label>
                      <input
                        id="set-model"
                        className="settings-input mono"
                        type="text"
                        value={editing.model}
                        onChange={(e) => setEditing((s) => ({ ...s, model: e.target.value }))}
                        placeholder="deepseek-chat"
                        spellCheck={false}
                        autoComplete="off"
                      />
                    </div>
                    <div className="settings-field">
                      <label className="settings-field-label" htmlFor="set-key">
                        {t('settings.apiKey')}
                      </label>
                      <input
                        id="set-key"
                        className="settings-input mono"
                        type="password"
                        value={editing.api_key}
                        onChange={(e) => setEditing((s) => ({ ...s, api_key: e.target.value }))}
                        placeholder={editing.hasKey ? t('settings.apiKeyKeep') : t('settings.apiKeyPh')}
                        spellCheck={false}
                        autoComplete="off"
                      />
                    </div>

                    <div className="settings-test-row">
                      <button type="button" className="settings-btn ghost" onClick={doTest} disabled={testing}>
                        {testing ? <Loader2 className="spin" /> : <Cable />}
                        <span>{testing ? t('settings.testing') : t('settings.test')}</span>
                      </button>
                      {testResult && (
                        <span className={`settings-test-result ${testResult.ok ? 'ok' : 'err'}`}>{testResult.msg}</span>
                      )}
                    </div>

                    <div className="model-editor-actions">
                      <button type="button" className="settings-btn ghost" onClick={cancelEdit}>
                        {t('cancel')}
                      </button>
                      <button
                        type="button"
                        className="settings-btn primary"
                        onClick={doSave}
                        disabled={saving || !editing.name.trim() || !editing.base_url.trim() || !editing.model.trim()}
                      >
                        {saving ? t('settings.saving') : t('settings.save')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {modelsLoaded && models.length === 0 && (
                      <div className="models-empty">
                        <div className="models-empty-title">{t('settings.modelsEmpty')}</div>
                        <div className="models-empty-sub">{t('settings.modelsEmptySub')}</div>
                      </div>
                    )}
                    <div className="models-list">
                      {models.map((m) => (
                        <div key={m.id} className="model-card">
                          <div className="model-card-main">
                            <div className="model-card-name">
                              <span className={`model-dot${m.has_key ? '' : ' off'}`} title={m.has_key ? t('settings.keyOk') : t('settings.keyNone')} />
                              <span className="model-card-title">{m.name}</span>
                              {m.is_default && <span className="model-badge">{t('settings.default')}</span>}
                            </div>
                            <div className="model-card-sub">
                              {m.model}
                              {m.base_url ? ` · ${m.base_url}` : ''}
                            </div>
                          </div>
                          <div className="model-card-actions">
                            {!m.is_default && (
                              <button type="button" className="model-btn" onClick={() => doSetDefault(m)}>
                                {t('settings.setDef')}
                              </button>
                            )}
                            <button type="button" className="model-btn" onClick={() => startEdit(m)}>
                              {t('settings.editModel')}
                            </button>
                            <button type="button" className="model-btn danger" onClick={() => doDelete(m)}>
                              {t('settings.delModel')}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button type="button" className="models-add" onClick={startCreate}>
                      <Plus />
                      <span>{t('settings.addModel')}</span>
                    </button>
                  </>
                )}
              </section>
            ) : (
              <section className="settings-section">
                <div className="settings-section-title">{t('language')}</div>
                <p className="settings-section-sub">{t('settings.langHint')}</p>
                <div className="settings-lang">
                  {LANGS.map((l) => (
                    <button
                      key={l}
                      type="button"
                      className={`lang-opt${lang === l ? ' active' : ''}`}
                      onClick={() => setLang(l)}
                    >
                      <span className="lang-flag">{l === 'zh' ? '中' : 'EN'}</span>
                      <span className="lang-label">{LANG_LABELS[l]}</span>
                      {lang === l && <Check className="lang-check" />}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
