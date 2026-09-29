import axios from 'axios'

// 统一的后端 API 客户端。开发环境经 vite proxy 转发到 FastAPI (http://127.0.0.1:8100)
const api = axios.create({
  baseURL: '/api',
  timeout: 180000,
})

// 对瞬时故障（后端 --reload 重启窗口 / 网络抖动）做退避重试，避免首屏加载报 502。
async function retry(fn, { retries = 3, delay = 600 } = {}) {
  let lastErr
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      const status = e?.response?.status
      const retriable = !status || [502, 503, 504].includes(status)
      if (!retriable || i === retries) throw e
      await new Promise((r) => setTimeout(r, delay * (i + 1)))
    }
  }
  throw lastErr
}

// 自动带上登录 token，供后端识别用户（用于长期记忆按用户归档）
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('askdata_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// 登录：payload = { email: string, password: string }
export function login(payload) {
  return api.post('/login', payload).then((res) => res.data)
}

// 读取某会话的历史消息（含模型历史回复），用于恢复对话
export function getHistory(sessionId) {
  return retry(() => api.get('/ask/history', { params: { session_id: sessionId } }).then((res) => res.data))
}

// 枚举历史会话列表（标题=首条用户消息，按最近更新倒序）
export function getSessions() {
  return retry(() => api.get('/ask/sessions').then((res) => res.data))
}

// 删除某个历史会话（连同它的所有历史消息）
export function deleteSession(sessionId) {
  return api.delete(`/ask/sessions/${encodeURIComponent(sessionId)}`).then((res) => res.data)
}

// 重命名某个会话（自定义标题；空标题回退为首条用户消息）
export function renameSession(sessionId, title) {
  return api
    .patch(`/ask/sessions/${encodeURIComponent(sessionId)}`, { title })
    .then((res) => res.data)
}

// 设置某会话绑定的数据源（每次对话只针对一个库；会话内可切换）。传空字符串清除绑定。
export function setSessionDataSource(sessionId, dataSourceId) {
  return api
    .patch(`/ask/sessions/${encodeURIComponent(sessionId)}/datasource`, {
      data_source_id: dataSourceId || null,
    })
    .then((res) => res.data)
}

// 导出某会话为 Markdown 文件（返回 Blob）
export function exportSession(sessionId) {
  return api
    .get(`/ask/sessions/${encodeURIComponent(sessionId)}/export`, { responseType: 'blob' })
    .then((res) => res.data)
}

// ===== 数据源管理（分开录入 PG 连接信息，服务端拼接连接串）=====

// 列出当前用户的数据源（不含密码）
export function getDataSources() {
  return retry(() => api.get('/datasources').then((res) => res.data))
}

// 新建数据源：payload = { name, host, port, dbname, username, password }
export function createDataSource(payload) {
  return api.post('/datasources', payload).then((res) => res.data)
}

// 更新数据源（字段可部分提供）
export function updateDataSource(id, payload) {
  return api
    .patch(`/datasources/${encodeURIComponent(id)}`, payload)
    .then((res) => res.data)
}

// 删除数据源
export function deleteDataSource(id) {
  return api.delete(`/datasources/${encodeURIComponent(id)}`).then((res) => res.data)
}

// 设为「使用中」（智能体查询用的数据源）
export function setDataSourceActive(id) {
  return api
    .post(`/datasources/${encodeURIComponent(id)}/active`)
    .then((res) => res.data)
}

// 测试已保存的数据源连通性
export function testDataSource(id) {
  return api
    .post(`/datasources/${encodeURIComponent(id)}/test`, null, { timeout: 30000 })
    .then((res) => res.data)
}

// 测试表单当前值（保存前即可试连）
export function testDataSourceRaw(payload) {
  return api.post('/datasources/test', payload, { timeout: 30000 }).then((res) => res.data)
}

// 内省：按表单当前值列出可用 schema（保存前的「获取 Schema」）
export function introspectSchemasRaw(payload) {
  return api
    .post('/datasources/introspect/schemas', payload, { timeout: 40000 })
    .then((res) => res.data)
}

// 内省：列出目标库 public 下的表（表名 + 注释）
export function introspectTables(id) {
  return api
    .post(`/datasources/${encodeURIComponent(id)}/introspect/tables`, null, { timeout: 40000 })
    .then((res) => res.data)
}

// 内省：列出某表的字段（字段名 + 类型）
export function introspectFields(id, table) {
  return api
    .post(`/datasources/${encodeURIComponent(id)}/introspect/fields/${encodeURIComponent(table)}`, null, {
      timeout: 40000,
    })
    .then((res) => res.data)
}

// 内省：预览某表前 N 行
export function introspectPreview(id, table, limit = 10) {
  return api
    .post(
      `/datasources/${encodeURIComponent(id)}/introspect/preview/${encodeURIComponent(table)}?limit=${limit}`,
      null,
      { timeout: 40000 },
    )
    .then((res) => res.data)
}

// 已策展的表（选中/可编辑）
export function getCuratedTables(id) {
  return api.get(`/datasources/${encodeURIComponent(id)}/tables`).then((res) => res.data)
}

// 全量保存选中的表 + 注释
export function saveCuratedTables(id, tables) {
  return api
    .put(`/datasources/${encodeURIComponent(id)}/tables`, { tables })
    .then((res) => res.data)
}

// 更新某张表的自定义注释 / 是否启用
export function updateCuratedTable(id, table, payload) {
  return api
    .patch(
      `/datasources/${encodeURIComponent(id)}/tables/${encodeURIComponent(table)}`,
      payload,
    )
    .then((res) => res.data)
}

// ===== 设置：对话模型配置（多模型） + 测试连接 =====

// 测试模型连接（不保存；空字段回退到已存 / 默认配置）
export function testLlmConfig(payload) {
  return api.post('/settings/llm/test', payload, { timeout: 40000 }).then((res) => res.data)
}

// 列出当前用户的全部模型配置（Key 打码，默认模型在前）
export function getLlmModels() {
  return retry(() => api.get('/settings/llm/models').then((res) => res.data))
}

// 新建模型配置：payload = { name, base_url, model, api_key }（第一个自动设为默认）
export function createLlmModel(payload) {
  return api.post('/settings/llm/models', payload).then((res) => res.data)
}

// 更新模型配置（空字段保留已有；api_key 留空则不改动）
export function updateLlmModel(modelId, payload) {
  return api.put(`/settings/llm/models/${encodeURIComponent(modelId)}`, payload).then((res) => res.data)
}

// 删除模型配置（删默认时后端自动提升剩余最早一条为默认）
export function deleteLlmModel(modelId) {
  return api.delete(`/settings/llm/models/${encodeURIComponent(modelId)}`).then((res) => res.data)
}

// 设为默认模型（聊天未显式选择时使用）
export function setLlmModelDefault(modelId) {
  return api.post(`/settings/llm/models/${encodeURIComponent(modelId)}/default`).then((res) => res.data)
}

export default api
