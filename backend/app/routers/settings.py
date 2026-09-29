from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.routers.ask import get_user_key
from app.services import llm_store

router = APIRouter(prefix="/api", tags=["settings"])


class LlmConfigRequest(BaseModel):
    base_url: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = None


class LlmModelRequest(BaseModel):
    name: Optional[str] = None
    base_url: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = None


@router.get("/settings/llm")
def get_llm(user_key: str = Depends(get_user_key)):
    """读取当前用户生效的对话模型配置：base_url/model 回退到 backend/.env；Key 只回打码值。"""
    cfg = llm_store.get_llm_config(user_key) or {}
    env_key, env_base, env_model = llm_store._env_fallback()
    stored_key = cfg.get("api_key") or ""
    return {
        "base_url": cfg.get("base_url") or env_base,
        "model": cfg.get("model") or env_model,
        "has_key": bool(stored_key or env_key),
        "key_masked": llm_store.mask_key(stored_key) if stored_key else "",
    }


@router.put("/settings/llm")
def save_llm(payload: LlmConfigRequest, user_key: str = Depends(get_user_key)):
    """保存对话模型配置（base_url / model / api_key）；api_key 留空则保留已有。"""
    ok = llm_store.set_llm_config(user_key, payload.base_url, payload.model, payload.api_key)
    return {"ok": ok, "saved": ok}


@router.post("/settings/llm/test")
def test_llm(payload: LlmConfigRequest, user_key: str = Depends(get_user_key)):
    """测试对话模型连接（不保存）；空字段回退到「已存配置 / backend/.env」。"""
    stored = llm_store.get_llm_config(user_key) or {}
    env_key, env_base, env_model = llm_store._env_fallback()
    base = (payload.base_url or "").strip() or stored.get("base_url") or env_base
    model = (payload.model or "").strip() or stored.get("model") or env_model
    key = (payload.api_key or "").strip() or stored.get("api_key") or env_key
    ok, msg = llm_store.test_llm_config(base, model, key)
    return {"ok": ok, "message": msg}


# ===== 多模型管理：一个用户可配置多个模型，聊天输入框可切换 =====

@router.get("/settings/llm/models")
def list_llm_models(user_key: str = Depends(get_user_key)):
    """列出当前用户的全部模型配置（Key 打码），默认模型在前。"""
    return {"models": llm_store.list_models(user_key)}


@router.post("/settings/llm/models")
def create_llm_model(payload: LlmModelRequest, user_key: str = Depends(get_user_key)):
    """新建模型配置（第一个自动设为默认）。"""
    m = llm_store.create_model(user_key, payload.name or "", payload.base_url or "",
                                payload.model or "", payload.api_key or "")
    return {"ok": True, "model": m}


@router.put("/settings/llm/models/{model_id}")
def update_llm_model(model_id: str, payload: LlmModelRequest, user_key: str = Depends(get_user_key)):
    """更新模型配置；空字段保留已有值（api_key 留空则不改动）。"""
    m = llm_store.update_model(user_key, model_id, payload.name, payload.base_url,
                               payload.model, payload.api_key)
    if m is None:
        raise HTTPException(status_code=404, detail="model not found")
    return {"ok": True, "model": m}


@router.delete("/settings/llm/models/{model_id}")
def delete_llm_model(model_id: str, user_key: str = Depends(get_user_key)):
    """删除模型配置；删除默认模型时自动把剩余最早一条提升为默认。"""
    ok = llm_store.delete_model(user_key, model_id)
    if not ok:
        raise HTTPException(status_code=404, detail="model not found")
    return {"ok": True}


@router.post("/settings/llm/models/{model_id}/default")
def set_llm_model_default(model_id: str, user_key: str = Depends(get_user_key)):
    """把指定模型设为默认（聊天未显式选择时用它）。"""
    ok = llm_store.set_default_model(user_key, model_id)
    if not ok:
        raise HTTPException(status_code=404, detail="model not found")
    return {"ok": True}
