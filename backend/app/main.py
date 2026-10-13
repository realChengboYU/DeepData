from dotenv import load_dotenv

load_dotenv()  # 加载 backend/.env（LLM 配置 / DATABASE_URL）

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import ask, assistant, auth, datasources, schema_index, settings, skills

app = FastAPI(
    title="DeepData API",
    version="0.1.0",
    description="DeepData 对话后端：多轮对话智能体（LLM + 短期记忆）。",
)

# 允许本地前端（Vite dev server）跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(ask.router)
app.include_router(assistant.router)
app.include_router(datasources.router)
app.include_router(schema_index.router)
app.include_router(skills.router)
app.include_router(settings.router)


@app.get("/api/health", tags=["system"])
def health() -> dict:
    return {"status": "ok", "service": "deepdata", "version": "0.1.0"}
