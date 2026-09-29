<p align="center"><img src="frontend/public/dog.png" alt="DeepData" width="96" height="96" /></p>

# DeepData

**用一句话，问清你的数据。** · *Ask your data in one sentence.*

DeepData 是一个**自然语言数据问答智能体**：你用中文描述想了解的问题，它连接你的 PostgreSQL 业务库，经 **LangGraph + LLM + SQL 工具**给出**可追溯、可解释**的回答，并把思考过程、工具调用、SQL 与图表透明地呈现在界面上。不用写 SQL，也不懂表结构——你只管提问。

---

## 功能亮点

- **一句话问数** —— 自然语言提问，模型经 SQL 工具自主查询，返回可核对的结果
- **思考与工具透明** —— `reasoning` 折叠卡、每次工具调用的参数与结果、SQL、图表逐一展示
- **数据源管理** —— 分开录入连接信息（地址 / 端口 / 库 / 账号 / 密码），服务端拼接连接串；密码 **AES-GCM** 加密落库，接口不回传明文
- **表 / 字段策展** —— 连目标库读元数据，勾选暴露给模型的表与字段，补业务注释与枚举说明
- **会话绑定数据源** —— 每个会话绑定一个库，会话内可切换；未指定时回退到「使用中」的数据源
- **多模型配置** —— OpenAI 兼容接口，页面增删改查 / 测连通 / 设默认，聊天时切换
- **会话管理** —— 多轮、历史持久化、重命名、删除、导出 Markdown
- **Apple 风格界面** —— 浅色、居中弹层、选表 / 表结构 / 数据预览

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 · Vite · Tailwind CSS v4 · assistant-ui · lucide-react · ECharts · Zustand · motion |
| 后端 | FastAPI · uvicorn · LangChain · LangGraph · SQLAlchemy · PyJWT · psycopg |
| 数据 | PostgreSQL（智能体记忆 `askdata_memory`）＋ 业务数据源（每用户管理，凭据加密） |

## 架构与工作原理

```text
用户一句话
   │
   ▼
FastAPI  POST /api/assistant　（assistant-transport SSE 流式，经 assistant_stream SDK）
   │  多轮历史（checkpointer，按 session_id）
   ▼
LangGraph 智能体　ChatDeepSeek(LLM) + SQL 工具
   │  ├─ 思考　→ 「reasoning」 事件
   │  ├─ 回答　→ 「text」 事件
   │  ├─ 工具　→ 「tool」 事件（name / args / result）
   │  └─ 图表　→ 「chart」 事件
   ▼
前端 assistant-ui Thread：思考折叠卡 + 工具调用卡 + 图表 + Markdown

数据源解析优先级：会话绑定 → 用户「使用中」 → 环境变量 PG_CONNECTION_STRING
```

## 快速开始

### 环境要求
- Node.js 18+（Vite）
- Python 3.11+（后端自带 `backend\.venv`）
- 本地 Docker（记忆库 `askdata_memory`）

### 1. 启动记忆库

```bash
cd backend
docker compose up -d
```

### 2. 配置后端环境

复制 `backend/.env.example` 为 `backend/.env`（已被 gitignore，不会提交）：

```bash
# 记忆存储（本地 Docker）
DATABASE_URL=postgresql://askdata:askdata@localhost:5432/askdata_memory

# JWT 签名密钥（生产务必改）
ASK_DATA_SECRET=change-me-in-prod

# 数据源凭据加密密钥（AES-GCM，32 字节 base64；生成方式见 .env.example 注释）
DS_CREDENTIAL_KEY=<your-32-byte-base64-key>

# 可选：LLM / 数据源兜底默认值（页面内可配置模型与数据源后可不填）
# LLM_BASE_URL=https://your-llm-endpoint/v1
# LLM_API_KEY=sk-xxxxxx
# LLM_MODEL_ID=your-model-id
# PG_CONNECTION_STRING=postgresql+psycopg://USER:PASSWORD@HOST:PORT/DB
```

> LLM 模型与数据源均可在页面内配置（多模型 / 多数据源）；`PG_CONNECTION_STRING` 仅在未配置任何数据源时作为兜底。

### 3. 启动后端（端口 8100）

```bash
cd backend
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8100 --reload
```

> 端口 8000 若被占用，后端改用 **8100**。

### 4. 启动前端（端口 5173）

```bash
cd frontend
pnpm install      # 或 npm install
pnpm dev          # 或 npm run dev  → http://127.0.0.1:5173
```

前端经 Vite 把 `/api` 代理到 `127.0.0.1:8100`（见 `frontend/vite.config.js`）。

### 演示账号

```
邮箱：demo@askdata.dev
密码：demo123456
```

## 环境变量

| 变量 | 说明 | 必填 |
|------|------|------|
| `DATABASE_URL` | 记忆库连接串（`askdata_memory`） | 是 |
| `ASK_DATA_SECRET` | JWT 签名密钥 | 建议 |
| `DS_CREDENTIAL_KEY` | 数据源密码 AES-GCM 加密密钥（32 字节 base64） | 生产建议 |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL_ID` | LLM 兜底配置（页面可配置后可不填） | 可选 |
| `PG_CONNECTION_STRING` | 业务数据源兜底连接串 | 可选 |
| `LANGSMITH_*` | LangSmith 追踪（可选） | 可选 |

## 目录结构

```text
AskData_Agent/
├─ frontend/                 # React 19 + Vite 前端
│  └─ src/
│     ├─ pages/              # Login / Chat / DataSources
│     ├─ components/
│     │  ├─ thread.aui.tsx   # assistant-ui Thread 封装（思考 / 工具卡）
│     │  ├─ promptbar/       # 输入栏（发送 / 停止 / 模型切换）
│     │  └─ datasource/      # 数据源：列表 / 表单 / 选表 / 表结构 / 预览 / 底部弹层
│     └─ api/index.js        # Axios 封装（登录 / 会话 / 数据源 / 设置）
│
└─ backend/                  # FastAPI 后端
   └─ app/
      ├─ main.py             # 入口 + CORS + /api/health
      ├─ config.py           # JWT / DATABASE_URL / 演示账号
      ├─ routers/            # assistant / auth / ask / datasources / settings / skills
      ├─ services/
      │  ├─ datasource_store.py  # 数据源存储 + 连接串拼接 + 测试
      │  ├─ llm_store.py         # 多模型配置存储 + 测试
      │  ├─ pipeline/            # LangGraph：graph / llm / runner / nodes
      │  └─ memory/store.py      # 记忆存储（checkpointer + 长期记忆）
      └─ datasource/pg.py        # PG 连接串兜底
```

## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| POST | `/api/login` | 登录，返回 JWT + 用户信息 |
| POST | `/api/assistant` | 流式问答（assistant-transport SSE） |
| GET | `/api/ask/history?session_id=` | 读取某会话历史 |
| GET | `/api/ask/sessions` | 枚举会话列表 |
| PATCH | `/api/ask/sessions/{id}` | 重命名会话 |
| PATCH | `/api/ask/sessions/{id}/datasource` | 绑定 / 切换会话数据源 |
| DELETE | `/api/ask/sessions/{id}` | 删除会话及其历史 |
| GET | `/api/ask/sessions/{id}/export` | 导出会话为 Markdown |
| GET / POST | `/api/datasources` | 数据源列表 / 新建（分开录入，服务端拼接连接串） |
| PATCH / DELETE | `/api/datasources/{id}` | 更新 / 删除数据源 |
| POST | `/api/datasources/{id}/test` | 测试已保存数据源连通性 |
| POST | `/api/datasources/test` | 按表单当前值试连 |
| POST | `/api/datasources/{id}/active` | 设为「使用中」 |
| POST | `/api/datasources/{id}/introspect/tables` | 列目标库表（表名 + 注释） |
| POST | `/api/datasources/{id}/introspect/fields/{table}` | 列某表字段 |
| POST | `/api/datasources/{id}/introspect/preview/{table}` | 预览某表前 N 行 |
| GET / PUT | `/api/datasources/{id}/tables` | 读 / 全量保存策展表 |
| PATCH | `/api/datasources/{id}/tables/{table}` | 更新某表注释 / 启用 |
| GET / POST / PUT / DELETE | `/api/settings/llm/models[/{id}]` | 多模型增删改查 |
| POST | `/api/settings/llm/models/{id}/default` | 设默认模型 |
| POST | `/api/settings/llm/test` | 测试 LLM 连接 |

### 流式协议（`/api/assistant`）

前端 `assistant-ui` 的 `assistant-transport` 协议，经 `assistant_stream` 序列化为 SSE（带心跳保活与 `id:` 序号，支持断线重连）。后端把智能体内部事件转成 `update-state` 增量推送。

```jsonc
{"type":"reasoning","delta":"思考增量"}
{"type":"text","delta":"回答增量"}
{"type":"tool","name":"sql_db_query","args":{...},"result":"...","status":"running|done"}
{"type":"chart","spec":{...}}
{"type":"error","error":"错误信息"}
{"type":"done","answer":"...","reasoning":[...],"tools":[...],"session_id":"..."}
```

## Roadmap

- [x] 登录（JWT）
- [x] 智能体对话页（SSE 流 + 思考 + Markdown）
- [x] LangGraph 多轮 + checkpointer
- [x] 数据源管理（分开录入 / 服务端拼接 / 测试 / 设为使用中）
- [x] 表 / 字段策展（元数据内省 + 勾选 + 业务注释）
- [x] 会话绑定数据源 + 历史 / 重命名 / 删除 / 导出
- [x] 多模型配置（增删改查 / 测试 / 设默认）
- [x] 对话宽度拖拽 + Apple 风格界面
- [ ] 图表一键生成（回答 → 可视化）
- [ ] 多数据源类型（MySQL 等）
- [ ] Docker / CI 部署

---

© DeepData · realChengboYU
