import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AssistantChat from '@/components/assistant-chat'
import DataSources from './DataSources'
import DsSwitcher from '../components/datasource/DsSwitcher'
import SettingsModal from '../components/settings/SettingsModal'
import { Book, Check, ChevronDown, Database, Download, MessageSquare, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Search, Settings, SquarePlus, Trash2, X } from 'lucide-react'
import { useI18n } from '../i18n'
import { useModelsStore } from '../store/models'
import { deleteSession, exportSession, getHistory, getSessions, renameSession, getDataSources, setSessionDataSource } from '../api'
import './chat.css'

function makeId() {
  return (crypto?.randomUUID?.() ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

export default function Chat() {
  const navigate = useNavigate()
  const { t } = useI18n()

  const [dsView, setDsView] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 当前会话绑定的数据源 id（每次对话只针对一个库；会话内可切换）
  const [currentDsId, setCurrentDsId] = useState(null)
  // 数据源列表（供顶部切换器 / 「使用中」默认）
  const [dataSources, setDataSources] = useState([])
  const dsInitializedRef = useRef(false)
  // 当前会话的历史消息（原始后端结构，交给 AssistantChat 转成 UI）
  const [historyMessages, setHistoryMessages] = useState([])
  // 每次历史重新加载都 +1，用作 AssistantChat 的 key 的一部分：
  // 运行结束后重新拉取历史让消息结构刷新，避免流式状态被覆盖后答案“消失”。
  const [historyVersion, setHistoryVersion] = useState(0)
  const [sessions, setSessions] = useState([])
  // 正在重命名的会话 id（null=不处于重命名态）
  const [renamingId, setRenamingId] = useState(null)
  const [renameInput, setRenameInput] = useState('')
  // 对话列宽度（rem）。悬停对话条左右边缘拖拽可调，限 56–72rem，持久化到 localStorage。
  const [threadWidth, setThreadWidth] = useState(() => {
    const v = Number(localStorage.getItem('askdata_chat_width'))
    if (Number.isFinite(v) && v >= 56 && v <= 72) return v
    return 64
  })
  const handleResizeWidth = (rem) => {
    const v = Math.min(72, Math.max(56, Math.round(rem)))
    setThreadWidth(v)
    localStorage.setItem('askdata_chat_width', String(v))
  }
  // 会话 id 存到 localStorage，刷新后仍能恢复同一个对话（含模型历史消息）
  const sessionIdRef = useRef(localStorage.getItem('askdata_session') || makeId())

  // 从后端拉取历史消息并填充到当前会话。
  // 用 sessionIdRef.current 做守卫：快速切换会话时，旧会话的异步返回不会覆盖新会话，保证历史隔离。
  const loadHistory = (sid) => {
    getHistory(sid)
      .then((data) => {
        if (sessionIdRef.current !== sid) return
        setHistoryMessages(data?.messages ?? [])
        setHistoryVersion((v) => v + 1)
      })
      .catch(() => {
        if (sessionIdRef.current !== sid) return
        setHistoryMessages([])
        setHistoryVersion((v) => v + 1)
      })
  }

  // 合并后端会话 + 本地“新建但还没发消息”的空会话占位，并把当前会话放到最前。
  // 这样：点击“新建会话”会新增一行；每个会话（含其全部历史）对应一行。
  const mergeSessions = (prev, backend) => {
    const backendIds = new Set(backend.map((s) => s.session_id))
    const list = [...backend]
    // 保留之前列表里、尚未写入后端且暂无消息的空会话（新建后还没发消息的占位行）
    for (const s of prev) {
      if (!backendIds.has(s.session_id) && s.message_count === 0) {
        list.push(s)
      }
    }
    // 当前会话置顶（没有就补一个“（新会话）”占位）
    const cur = sessionIdRef.current
    const curItem =
      list.find((s) => s.session_id === cur) ??
      ({ session_id: cur, title: '（新会话）', updated_at: '', message_count: 0 })
    return [curItem, ...list.filter((s) => s.session_id !== cur)]
  }

  // 刷新侧栏「会话列表」
  const refreshSessions = () => {
    getSessions()
      .then((data) => {
        const backend = data?.sessions ?? []
        setSessions((prev) => mergeSessions(prev, backend))
        // 仅首次：用后端持久化的绑定初始化当前会话的数据源（不覆盖会话内的手动切换）
        if (!dsInitializedRef.current) {
          dsInitializedRef.current = true
          const cur = backend.find((s) => s.session_id === sessionIdRef.current)
          setCurrentDsId(cur ? cur.data_source_id || null : null)
        }
      })
      .catch(() => setSessions((prev) => mergeSessions(prev, [])))
  }

  // 每次运行结束：刷新会话列表，并重新拉取当前会话历史。
  // 重新拉取会让 initialMessages 带上刚生成的回答，AssistantChat 随 key 变更重挂载，
  // 从而修复「答案出现后又消失」。
  const handleRunFinish = () => {
    refreshSessions()
    loadHistory(sessionIdRef.current)
  }

  // 切换到指定会话：更新 session id，并加载它的历史 + 该会话绑定的数据源
  const openSession = (sid) => {
    setDsView(false)
    if (!sid || sid === sessionIdRef.current) return
    sessionIdRef.current = sid
    localStorage.setItem('askdata_session', sid)
    const found = sessions.find((s) => s.session_id === sid)
    setCurrentDsId(found ? found.data_source_id || null : null)
    loadHistory(sid)
  }

  // 删除某个历史会话：调用后端删除，并从列表中移除。
  // 若删的是「当前会话」，优先切到最近一个「有消息」的剩余会话（不弹“新建会话”）；都没有则清空为空白对话（也不新增占位行）。
  const removeSession = (sid) => {
    if (!window.confirm('确定删除该会话？此操作不可撤销')) return
    deleteSession(sid)
      .then(() => {
        const rest = sessions.filter((s) => s.session_id !== sid)
        setSessions(rest)
        if (sid === sessionIdRef.current) {
          const withMsgs = rest.filter((s) => (s.message_count ?? 0) > 0)
          const next = withMsgs[0] ?? rest[0]
          if (next) {
            // 切到剩余会话（优先有消息的），不再新建会话
            openSession(next.session_id)
          } else {
            // 没有剩余会话：重置为空白对话，但不新增“（新会话）”行
            sessionIdRef.current = makeId()
            localStorage.setItem('askdata_session', sessionIdRef.current)
            setHistoryMessages([])
          }
        }
      })
      .catch(() => {})
  }

  // 进入重命名态：填入当前标题，显示输入框
  const startRename = (s) => {
    setRenamingId(s.session_id)
    setRenameInput(s.title || '')
  }

  // 提交重命名：调用后端，更新本地列表标题
  const submitRename = (sid) => {
    const title = renameInput.trim()
    renameSession(sid, title)
      .then(() => {
        setSessions((prev) =>
          prev.map((s) =>
            s.session_id === sid ? { ...s, title: title || s.title } : s,
          ),
        )
      })
      .catch(() => {})
      .finally(() => {
        setRenamingId(null)
        setRenameInput('')
      })
  }

  const cancelRename = () => {
    setRenamingId(null)
    setRenameInput('')
  }

  // 导出会话为 Markdown：后端返回 Blob，触发下载
  const exportThisSession = (sid) => {
    exportSession(sid)
      .then((blob) => {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `deepdata-${(sid || 'session').slice(0, 8)}.md`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      })
      .catch(() => {})
  }

  // 挂载时：持久化会话 id，恢复历史消息，加载侧栏「会话列表」，拉取模型配置列表
  useEffect(() => {
    localStorage.setItem('askdata_session', sessionIdRef.current)
    loadHistory(sessionIdRef.current)
    refreshSessions()
    useModelsStore.getState().load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 每次处于对话视图都刷新数据源列表（新建 / 编辑数据源后，切换器保持最新）
  useEffect(() => {
    if (!dsView) loadDataSources()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dsView])

  function logout() {
    localStorage.removeItem('askdata_token')
    localStorage.removeItem('askdata_user')
    navigate('/login')
  }

  function newChat() {
    setDsView(false)
    sessionIdRef.current = makeId()
    localStorage.setItem('askdata_session', sessionIdRef.current)
    setHistoryMessages([])
    // 新建会话默认绑定「使用中」的数据源（没有则为空，可在顶部切换器选择）
    const activeId = dataSources.find((d) => d.is_active)?.id || null
    setCurrentDsId(activeId)
    setSessions((prev) => [
      { session_id: sessionIdRef.current, title: '（新会话）', updated_at: '', message_count: 0, data_source_id: activeId },
      ...prev.filter((s) => s.session_id !== sessionIdRef.current),
    ])
    if (activeId) setSessionDataSource(sessionIdRef.current, activeId)
  }

  // 从某数据源卡片「直接问数」：新建一个会话并绑定该数据源，然后进入对话视图
  function newChatWithSource(dsId) {
    sessionIdRef.current = makeId()
    localStorage.setItem('askdata_session', sessionIdRef.current)
    setHistoryMessages([])
    setDsView(false)
    setCurrentDsId(dsId || null)
    setSessions((prev) => [
      { session_id: sessionIdRef.current, title: '（新会话）', updated_at: '', message_count: 0, data_source_id: dsId || null },
      ...prev.filter((s) => s.session_id !== sessionIdRef.current),
    ])
    if (dsId) setSessionDataSource(sessionIdRef.current, dsId)
  }

  // 会话内切换数据源：更新本地状态 + 持久化到该会话
  const switchDs = (dsId) => {
    if (dsId === currentDsId) return
    const sid = sessionIdRef.current
    setCurrentDsId(dsId || null)
    setSessions((prev) => prev.map((s) => (s.session_id === sid ? { ...s, data_source_id: dsId || null } : s)))
    if (sid) setSessionDataSource(sid, dsId)
  }

  // 拉取数据源列表（供顶部切换器 + 「使用中」默认）
  const loadDataSources = () => {
    getDataSources()
      .then((d) => setDataSources(d?.sources ?? []))
      .catch(() => setDataSources([]))
  }

  const user = JSON.parse(localStorage.getItem('askdata_user') || '{}')

  // 两个侧栏各自可收缩（偏好持久化）：导航栏收成图标条，会话栏收成窄条
  const [railCollapsed, setRailCollapsed] = useState(() => localStorage.getItem('dd_rail_collapsed') === '1')
  const [sessionsCollapsed, setSessionsCollapsed] = useState(() => localStorage.getItem('dd_sessions_collapsed') === '1')
  const toggleRail = () =>
    setRailCollapsed((v) => {
      const n = !v
      localStorage.setItem('dd_rail_collapsed', n ? '1' : '')
      return n
    })
  const toggleSessions = () =>
    setSessionsCollapsed((v) => {
      const n = !v
      localStorage.setItem('dd_sessions_collapsed', n ? '1' : '')
      return n
    })

  // 窄屏（≤1100px）：自动收起两个侧栏保证主区宽度；越线切回宽屏时恢复展开。手动操作即时生效，越线时以屏幕宽度为准
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1100px)')
    const apply = (matches) => {
      setRailCollapsed(matches)
      setSessionsCollapsed(matches)
    }
    if (mq.matches) apply(true)
    const onChange = (e) => apply(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return (
    <div className="chat">
          {/* 导航栏：统一管理局部功能模块（对话 / 数据源 / …，macOS Finder 式窄栏，可收缩为图标条） */}
          <aside className={`chat-rail${railCollapsed ? ' collapsed' : ''}`}>
            <div className="rail-brand">
              <img src="/dog.png" alt="DeepData" />
              <span className="rail-word">deepdata</span>
            </div>
            <nav className="rail-nav" aria-label="功能模块">
              <button type="button" className={`rail-icon${dsView ? '' : ' active'}`} title={t('nav.chat')} onClick={() => setDsView(false)}>
                <MessageSquare />
                <span className="rail-icon-label">{t('nav.chat')}</span>
              </button>
              <button type="button" className="rail-icon" title={t('nav.kb')}>
                <Book />
                <span className="rail-icon-label">{t('nav.kb')}</span>
              </button>
              <button type="button" className={`rail-icon${dsView ? ' active' : ''}`} title={t('ds.title')} onClick={() => setDsView(true)}>
                <Database />
                <span className="rail-icon-label">{t('ds.title')}</span>
              </button>
              <button type="button" className="rail-icon" title={t('nav.window')}>
                <SquarePlus />
                <span className="rail-icon-label">{t('nav.window')}</span>
              </button>
              <button type="button" className="rail-icon" title={t('nav.search')}>
                <Search />
                <span className="rail-icon-label">{t('nav.search')}</span>
              </button>
              <button type="button" className="rail-icon" title={t('settings')} onClick={() => setSettingsOpen(true)}>
                <Settings />
                <span className="rail-icon-label">{t('settings')}</span>
                <ChevronDown className="rail-icon-caret" aria-hidden="true" />
              </button>
            </nav>
            <div className="rail-spacer" />
            {/* 底部：用户 + 侧拉（收缩/展开）按钮，参考样式 */}
            <div className="rail-foot">
              <div className="rail-user">
                <span className="rail-avatar" aria-hidden="true">
                  {(user?.name || 'D').charAt(0).toUpperCase()}
                </span>
                <span className="rail-user-name">{user?.name || 'deepdata'}</span>
              </div>
              <button
                type="button"
                className="rail-toggle"
                title={t('toggleSidebar')}
                aria-label={t('toggleSidebar')}
                onClick={toggleRail}
              >
                {railCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              </button>
            </div>
          </aside>

          {/* 会话历史侧边栏：仅聊天视图（保持挂载、display 切换以保留重命名状态，可收缩为窄条） */}
          <aside className={`chat-sessions${dsView ? ' hidden' : ''}${sessionsCollapsed ? ' collapsed' : ''}`}>
            <div className="chat-sessions-head">
              <span className="cs-title">{t('sessions')}</span>
              <button
                type="button"
                className="cs-toggle"
                title={t('toggleSidebar')}
                aria-label={t('toggleSidebar')}
                onClick={toggleSessions}
              >
                {sessionsCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              </button>
            </div>
            <button type="button" className="side-new" onClick={newChat}>
              <Plus />
              <span>{t('newChat')}</span>
            </button>

            <div className="side-sessions">
              {sessions.length === 0 ? (
                <div className="side-empty">{t('noSessions')}</div>
              ) : (
                sessions.map((s) => (
                  <div
                    key={s.session_id}
                    className={`side-session${s.session_id === sessionIdRef.current ? ' active' : ''}`}
                  >
                    {renamingId === s.session_id ? (
                      <div
                        className="side-session-rename"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          className="side-session-rename-input"
                          value={renameInput}
                          autoFocus
                          onChange={(e) => setRenameInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') submitRename(s.session_id)
                            if (e.key === 'Escape') cancelRename()
                          }}
                        />
                        <button
                          type="button"
                          className="side-session-rename-ok"
                          title="确认"
                          aria-label="确认"
                          onClick={() => submitRename(s.session_id)}
                        >
                          <Check />
                        </button>
                        <button
                          type="button"
                          className="side-session-rename-cancel"
                          title="取消"
                          aria-label="取消"
                          onClick={cancelRename}
                        >
                          <X />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="side-session-open"
                          onClick={() => openSession(s.session_id)}
                          title={s.title}
                        >
                          <MessageSquare className="side-session-icon" />
                          <span className="side-session-title">{s.title}</span>
                        </button>
                        <button
                          type="button"
                          className="side-session-action"
                          title="重命名"
                          aria-label="重命名"
                          onClick={(e) => {
                            e.stopPropagation()
                            startRename(s)
                          }}
                        >
                          <Pencil />
                        </button>
                        <button
                          type="button"
                          className="side-session-action"
                          title="导出 Markdown"
                          aria-label="导出"
                          onClick={(e) => {
                            e.stopPropagation()
                            exportThisSession(s.session_id)
                          }}
                        >
                          <Download />
                        </button>
                        <button
                          type="button"
                          className="side-session-del"
                          title="删除会话"
                          aria-label="删除会话"
                          onClick={(e) => {
                            e.stopPropagation()
                            removeSession(s.session_id)
                          }}
                        >
                          <Trash2 />
                        </button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </aside>

          <div className={`chat-main${dsView ? ' is-ds' : ''}`} style={{ ['--thread-max-width']: `${threadWidth}rem` }}>
            {/* 两个视图都保持挂载，用 display 切换：切到数据源再返回时，
                AssistantChat 的内部状态（滚动 / 草稿 / 展开的思考 / 进行中的流）得以保留。 */}
            <div className={`chat-view${dsView ? ' hidden' : ''}`}>
              <header className="chat-head">
                <div className="chat-head-left">
                  {/* 会话栏收起后：展开 + 新建 按钮出现在数据源切换器左侧 */}
                  {sessionsCollapsed ? (
                    <>
                      <button
                        type="button"
                        className="chat-head-ic"
                        title={t('toggleSidebar')}
                        aria-label={t('toggleSidebar')}
                        onClick={toggleSessions}
                      >
                        <PanelLeftOpen />
                      </button>
                      <button type="button" className="chat-head-ic" title={t('newChat')} aria-label={t('newChat')} onClick={newChat}>
                        <Plus />
                      </button>
                    </>
                  ) : null}
                  <DsSwitcher value={currentDsId} sources={dataSources} onChange={switchDs} t={t} />
                </div>
                <div className="chat-head-right">
                  <span className="chat-user">{user?.name || 'deepdata'}</span>
                  <button className="chat-logout" onClick={logout}>{t('logout')}</button>
                </div>
              </header>
              <main className="chat-body">
                <AssistantChat
                  key={`${sessionIdRef.current}:${historyVersion}`}
                  threadId={sessionIdRef.current}
                  dataSourceId={currentDsId}
                  initialMessages={historyMessages}
                  onFinish={handleRunFinish}
                  onResizeWidth={handleResizeWidth}
                />
              </main>
            </div>
            {dsView && (
              <div className="ds-view">
                <DataSources onBackToChat={() => setDsView(false)} onAsk={newChatWithSource} />
              </div>
            )}
          </div>

          <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </div>
  )
}
