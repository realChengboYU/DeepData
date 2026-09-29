import { create } from 'zustand'
import { getLlmModels } from '../api'

const STORAGE_KEY = 'askdata_model_id'

function readStoredId() {
  try {
    return localStorage.getItem(STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

// 写回 localStorage（选中模型按用户浏览器持久化，刷新后恢复）
function persist(id) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

/**
 * 模型列表 + 聊天输入框当前选中的模型。
 * 单一数据源：设置弹窗（增删改 / 设默认）与 PromptBar 模型选择器共用，
 * 任何一边的变更都通过 load() / setModels() 刷新另一边。
 */
export const useModelsStore = create((set, get) => ({
  models: [],
  selectedId: readStoredId(),
  loaded: false,

  // 拉取模型列表；当前选中项不存在（如被删除）时回退到默认 / 第一条
  load: async () => {
    try {
      const d = await getLlmModels()
      get()._apply(d?.models ?? [])
      return get().models
    } catch {
      set({ loaded: true })
      return get().models
    }
  },

  // 设置弹窗 CRUD 后直接灌入最新列表（保留仍有效的选中项）
  setModels: (models) => get()._apply(models ?? []),

  // 聊天输入框选择模型；空串 = 跟随默认模型
  select: (id) => {
    const selectedId = (id || '').trim()
    set({ selectedId })
    persist(selectedId)
  },

  _apply: (models) => {
    const cur = get().selectedId
    const selectedId = models.some((m) => m.id === cur)
      ? cur
      : models.find((m) => m.is_default)?.id ?? models[0]?.id ?? ''
    set({ models, selectedId, loaded: true })
  },
}))
