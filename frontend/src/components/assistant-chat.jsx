import { useMemo, useRef } from 'react'
import {
  AssistantRuntimeProvider,
  useAssistantTransportRuntime,
} from '@assistant-ui/react'
import { Thread } from '@/components/thread.aui'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ComposerControlsContext } from '@/components/promptbar/controls'
import { useModelsStore } from '@/store/models'

// 生成消息 / part id（无 crypto 时退化）
function makeId() {
  return (crypto?.randomUUID?.() ?? `m-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

function extractText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === 'object' && typeof p.text === 'string' ? p.text : ''))
      .join('')
  }
  return ''
}

// 后端历史消息（checkpointer）转成 state.messages 结构
function historyToState(history) {
  return (history ?? []).map((m) => {
    const isAssistant = m.role === 'assistant'
    const content = []
    if (isAssistant) {
      if (m.reasoning) content.push({ type: 'reasoning', text: m.reasoning })
      for (const t of m.tools ?? []) {
        content.push({
          type: 'tool-call',
          toolCallId: t?.id ?? makeId(),
          toolName: t?.name,
          args: t?.args ?? {},
          result: t?.result,
        })
      }
      // 历史里持久化的图表 spec -> chart part，刷新/切换会话后仍能恢复图表
      for (const c of m.charts ?? []) {
        content.push({ type: 'chart', spec: c })
      }
      content.push({ type: 'text', text: m.content ?? '' })
    } else {
      content.push({ type: 'text', text: m.content ?? '' })
    }
    return { id: m.id ?? makeId(), role: m.role, content }
  })
}

// 把 state.messages 转成 assistant-ui ThreadMessage[]
// 注意：assistant-ui 每个 part 都要有 status，否则 grouped/streaming 渲染会读取
// undefined.type 而白屏；tool 结果直接嵌入 tool-call part（自定义渲染器读 part.result）。
function convertStateMessages(state) {
  const messages = state?.messages ?? []
  const isRunning = Boolean(state?.isRunning)
  return messages.map((m, mi) => {
    const isAssistant = m.role === 'assistant'
    // isRunning 只作用于当前在跑的最后一条 assistant 消息
    const isRunningMsg = isAssistant && isRunning && mi === messages.length - 1
    const parts = []
    const content = m.content ?? []
    for (let i = 0; i < content.length; i++) {
      const p = content[i]
      let mapped
      if (p?.type === 'reasoning') {
        mapped = { type: 'reasoning', text: p.text ?? '' }
      } else if (p?.type === 'text') {
        mapped = { type: 'text', text: p.text ?? '' }
      } else if (p?.type === 'tool-call') {
        // argsText 必须是原始 JSON 字符串：ToolInvocationTracker 会对它做 startsWith 比较
        const args = p.args ?? {}
        mapped = {
          type: 'tool-call',
          toolCallId: p.toolCallId ?? makeId(),
          toolName: p.toolName,
          args,
          argsText: JSON.stringify(args),
        }
        if (p.result !== undefined && p.result !== null) mapped.result = p.result
      } else if (p?.type === 'clarification') {
        mapped = { type: 'clarification', question: p.question, options: p.options ?? [] }
      } else if (p?.type === 'chart') {
        mapped = { type: 'chart', spec: p.spec ?? {} }
      } else {
        mapped = { type: 'text', text: JSON.stringify(p) }
      }
      // 每个 part 都必须有 status
      // 运行中的最后一条助手消息：reasoning 与「最后打开/等待结果」的 part 保持 running，
      // 这样思考过程在整个运行期间都显示活跃指示（否则看到工具调用后就显得卡住）。
      let pStatus
      if (isAssistant) {
        const toolAwaiting = p?.type === 'tool-call' && p.result == null
        const isLastPart = i === content.length - 1
        pStatus =
          isRunningMsg && (p?.type === 'reasoning' || isLastPart || toolAwaiting)
            ? { type: 'running' }
            : { type: 'complete' }
      } else {
        pStatus = { type: 'complete' }
      }
      parts.push({ ...mapped, status: pStatus })
    }
    const mStatus = isAssistant
      ? isRunningMsg
        ? { type: 'running' }
        : { type: 'complete', reason: 'stop' }
      : undefined
    // ThreadMessage.metadata 是必填对象，缺失会让 s.message.metadata.modality 崩
    const metadata = { modality: 'text', custom: {} }
    return {
      id: m.id ?? makeId(),
      role: m.role,
      content: parts,
      ...(mStatus ? { status: mStatus } : {}),
      metadata,
    }
  })
  return messages
}

// 极简状态 converter：后端 state -> { messages, isRunning }
const converter = (state, connectionMetadata) => ({
  messages: convertStateMessages(state),
  isRunning: Boolean(state?.isRunning || connectionMetadata.isSending),
  state,
})

/**
 * assistant-transport 会话组件：独占一条会话的 runtime + Thread。
 * 通过 key=threadId 重挂载实现换会话（重新加载历史为 initialState）。
 */
export default function AssistantChat({
  threadId,
  initialMessages = [],
  onFinish,
  onResizeWidth,
  dataSourceId,
}) {
  const initialState = useMemo(
    () => ({ messages: historyToState(initialMessages), isRunning: false }),
    [initialMessages, threadId],
  )

  // 会话内切换数据源不会触发重挂载（key 不变），用 ref 让 runtime 的稳定回调始终读到最新绑定
  const dsRef = useRef(dataSourceId)
  dsRef.current = dataSourceId

  const runtime = useAssistantTransportRuntime({
    initialState,
    api: '/api/assistant',
    protocol: 'assistant-transport',
    converter,
    headers: async () => {
      const token = localStorage.getItem('askdata_token')
      return token ? { Authorization: `Bearer ${token}` } : {}
    },
    prepareSendCommandsRequest: (body) => ({
      ...body,
      threadId,
      dataSourceId: dsRef.current || null,
      // 聊天输入框当前选中的模型（设置里配置的多个模型之一；未配置/未选择为 null）
      modelId: useModelsStore.getState().selectedId || null,
    }),
    onFinish: () => onFinish?.(),
    onError: () => onFinish?.(),
    onCancel: () => onFinish?.(),
  })

  // 供「引用某条回答追问」设置输入框文本 + 聚焦
  const composerRef = useRef(null)

  const composerControls = useMemo(
    () => ({
      onStop: () => runtime.thread.stop?.(),
      composerRef: composerRef,
      // assistant-transport 的 convertAppendMessageToCommand 要求 content 是 parts 数组；
      // 传字符串会被展开成字符、找不到 text part 而被跳过（消息被吞）。这里统一归一化。
      send: (msg) => {
        const content =
          typeof msg?.content === 'string'
            ? [{ type: 'text', text: msg.content }]
            : msg?.content
        return runtime.thread.append({ ...msg, content })
      },
    }),
    [runtime],
  )

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ComposerControlsContext.Provider value={composerControls}>
        <TooltipProvider>
          <Thread onResizeWidth={onResizeWidth} />
        </TooltipProvider>
      </ComposerControlsContext.Provider>
    </AssistantRuntimeProvider>
  )
}
