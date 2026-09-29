"""LLM 配置存储：让登录用户在「设置」里配置对话模型（Base URL / 名称 / API Key）。

- 按 user_key（登录邮箱）各自存一份；未配置时回退到 backend/.env 的 LLM 配置。
- 支持一个用户配置**多个模型**（llm_models 表），可设「默认」；旧单配置（llm_configs）
  首次访问时自动迁移为一条默认模型。
- API Key 复用数据源凭据加密（credential_crypto）AES-GCM 落库，接口只回传打码值。
- 提供「测试连接」：用给定配置发一次最小 LLM 调用验证连通性。
"""

from __future__ import annotations

import os
import uuid
from typing import Optional

from app.services.credential_crypto import decrypt, encrypt
from app.services.memory.store import get_pool

_TABLE = "llm_configs"
_MODELS_TABLE = "llm_models"


def _ensure_table() -> None:
    with get_pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {_TABLE} (
                    user_key   text        PRIMARY KEY,
                    base_url   text,
                    model      text,
                    api_key    text,
                    updated_at timestamptz NOT NULL DEFAULT now()
                )
                """
            )


def _ensure_models_table() -> None:
    with get_pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {_MODELS_TABLE} (
                    id         text        PRIMARY KEY,
                    user_key   text        NOT NULL,
                    name       text        NOT NULL,
                    base_url   text,
                    model      text,
                    api_key    text,
                    is_default boolean     NOT NULL DEFAULT false,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    updated_at timestamptz NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute(
                f"CREATE INDEX IF NOT EXISTS idx_llm_models_user ON {_MODELS_TABLE} (user_key)"
            )


def _row_to_model(row: tuple, mask: bool = True) -> dict:
    (mid, user_key, name, base_url, model, api_key, is_default, created_at, updated_at) = row
    key = decrypt(api_key) if api_key else ""
    return {
        "id": mid,
        "user_key": user_key,
        "name": name,
        "base_url": base_url or "",
        "model": model or "",
        "api_key": "" if mask else key,
        "has_key": bool(key),
        "key_masked": mask_key(key) if mask else "",
        "is_default": bool(is_default),
        "created_at": str(created_at) if created_at else "",
        "updated_at": str(updated_at) if updated_at else "",
    }


def _migrate_legacy(user_key: str) -> None:
    """一次性迁移（幂等，带状态标记，不会在用户删光模型后再次触发）：

    1. 旧单配置（llm_configs）有内容 -> 迁移为一条默认模型；
    2. 没有旧配置但 backend/.env 配了 LLM -> 用 env 配置种子出一条默认模型
       （把原来 .env 里生效的模型直接带进界面）。
    """
    _ensure_table()
    _ensure_models_table()
    with get_pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS llm_migration_state (
                    user_key  text PRIMARY KEY,
                    seeded_at timestamptz NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute(
                f"SELECT count(*) FROM {_MODELS_TABLE} WHERE user_key=%s",
                [user_key],
            )
            has_models = (cur.fetchone() or [0])[0] > 0
            cur.execute("SELECT 1 FROM llm_migration_state WHERE user_key=%s", [user_key])
            already = cur.fetchone() is not None
            if has_models and not already:
                cur.execute("INSERT INTO llm_migration_state (user_key) VALUES (%s)", [user_key])
            if has_models or already:
                return
            cur.execute("INSERT INTO llm_migration_state (user_key) VALUES (%s)", [user_key])
            cur.execute(
                f"SELECT base_url, model, api_key FROM {_TABLE} WHERE user_key=%s",
                [user_key],
            )
            row = cur.fetchone()
    if row:
        base_url, model, api_key = row
        legacy_key = decrypt(api_key) if api_key else ""
        if base_url or model or legacy_key:
            _insert_model(user_key, model or "默认模型", base_url or "", model or "", legacy_key, is_default=True)
            return
    # 无旧配置：用 backend/.env 的 LLM 配置种子一条（Key 一并落库，之后以界面为准）
    env_key, env_base, env_model = _env_fallback()
    if env_model or env_base:
        _insert_model(user_key, env_model or "默认模型", env_base, env_model or "", env_key or "", is_default=True)


def _insert_model(
    user_key: str,
    name: str,
    base_url: str,
    model: str,
    api_key: str,
    is_default: bool,
    model_id: Optional[str] = None,
) -> str:
    mid = model_id or uuid.uuid4().hex
    with get_pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO {_MODELS_TABLE} "
                "(id, user_key, name, base_url, model, api_key, is_default, created_at, updated_at) "
                "VALUES(%s, %s, %s, %s, %s, %s, %s, now(), now())",
                [mid, user_key, name, base_url or "", model or "", encrypt(api_key) if api_key else "", is_default],
            )
    return mid


def list_models(user_key: str) -> list[dict]:
    """列出该用户的全部模型配置（Key 打码）；先把旧单配置迁移进来。默认模型在前。"""
    _migrate_legacy(user_key)
    with get_pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT id, user_key, name, base_url, model, api_key, is_default, created_at, updated_at "
                f"FROM {_MODELS_TABLE} WHERE user_key=%s ORDER BY is_default DESC, created_at ASC",
                [user_key],
            )
            rows = cur.fetchall()
    return [_row_to_model(r) for r in rows]


def _fetch_model_row(user_key: str, model_id: str) -> Optional[tuple]:
    _ensure_models_table()
    with get_pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT id, user_key, name, base_url, model, api_key, is_default, created_at, updated_at "
                f"FROM {_MODELS_TABLE} WHERE id=%s AND user_key=%s",
                [model_id, user_key],
            )
            return cur.fetchone()


def get_model(user_key: str, model_id: str) -> Optional[dict]:
    """按 id 取该用户的某个模型（Key 打码，可安全回传前端）；不存在返回 None。"""
    row = _fetch_model_row(user_key, model_id)
    return _row_to_model(row, mask=True) if row else None


def _get_model_plain(user_key: str, model_id: str) -> Optional[dict]:
    """内部使用：取模型配置（Key 解密明文）。不要直接回传前端。"""
    row = _fetch_model_row(user_key, model_id)
    return _row_to_model(row, mask=False) if row else None


def create_model(
    user_key: str,
    name: str,
    base_url: str = "",
    model: str = "",
    api_key: str = "",
) -> dict:
    """新建一个模型配置；若是该用户第一个，自动设为默认。返回新建模型（Key 打码）。"""
    _migrate_legacy(user_key)
    existing = list_models(user_key)
    mid = _insert_model(
        user_key,
        (name or "").strip() or f"模型 {len(existing) + 1}",
        (base_url or "").strip(),
        (model or "").strip(),
        (api_key or "").strip(),
        is_default=not existing,
    )
    return get_model(user_key, mid)


def update_model(
    user_key: str,
    model_id: str,
    name: Optional[str] = None,
    base_url: Optional[str] = None,
    model: Optional[str] = None,
    api_key: Optional[str] = None,
) -> Optional[dict]:
    """更新模型配置；空字段保留已有值（api_key 留空则不改动）。返回打码视图。"""
    cur = _get_model_plain(user_key, model_id)
    if cur is None:
        return None
    with get_pool().connection() as conn:
        with conn.cursor() as c:
            c.execute(
                f"UPDATE {_MODELS_TABLE} SET name=%s, base_url=%s, model=%s, "
                "api_key=%s, updated_at=now() WHERE id=%s AND user_key=%s",
                [
                    (name or "").strip() or cur["name"],
                    (base_url or "").strip() or cur["base_url"],
                    (model or "").strip() or cur["model"],
                    encrypt((api_key or "").strip() or cur["api_key"]) if ((api_key or "").strip() or cur["api_key"]) else "",
                    model_id,
                    user_key,
                ],
            )
    return get_model(user_key, model_id)


def delete_model(user_key: str, model_id: str) -> bool:
    """删除模型；若删的是默认且仍有剩余，把最早一条提升为默认。"""
    _ensure_models_table()
    target = get_model(user_key, model_id)
    if target is None:
        return False
    with get_pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"DELETE FROM {_MODELS_TABLE} WHERE id=%s AND user_key=%s",
                [model_id, user_key],
            )
            if target["is_default"]:
                cur.execute(
                    f"SELECT id FROM {_MODELS_TABLE} WHERE user_key=%s ORDER BY created_at ASC LIMIT 1",
                    [user_key],
                )
                nxt = cur.fetchone()
                if nxt:
                    cur.execute(
                        f"UPDATE {_MODELS_TABLE} SET is_default=true, updated_at=now() WHERE id=%s",
                        [nxt[0]],
                    )
    return True


def set_default_model(user_key: str, model_id: str) -> bool:
    """把指定模型设为默认（取消同用户其它默认标记）。"""
    if get_model(user_key, model_id) is None:
        return False
    with get_pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE {_MODELS_TABLE} SET is_default=false WHERE user_key=%s",
                [user_key],
            )
            cur.execute(
                f"UPDATE {_MODELS_TABLE} SET is_default=true, updated_at=now() WHERE id=%s AND user_key=%s",
                [model_id, user_key],
            )
    return True


def _default_model(user_key: str) -> Optional[dict]:
    """该用户的默认模型；没有默认则取最早一条。"""
    _ensure_models_table()
    with get_pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT id, user_key, name, base_url, model, api_key, is_default, created_at, updated_at "
                f"FROM {_MODELS_TABLE} WHERE user_key=%s ORDER BY is_default DESC, created_at ASC LIMIT 1",
                [user_key],
            )
            row = cur.fetchone()
    return _row_to_model(row, mask=False) if row else None


def _env_fallback() -> tuple:
    """backend/.env 的 LLM 配置（未登录用户界面配置时的回退）。返回 (api_key|None, base_url, model)。"""
    api_key = os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY") or os.getenv("DEEPSEEK_API_KEY")
    base_url = os.getenv("LLM_BASE_URL") or os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1"
    model = os.getenv("LLM_MODEL") or os.getenv("LLM_MODEL_ID") or "gpt-4o-mini"
    return (api_key or None), base_url, model


def get_llm_config(user_key: str) -> Optional[dict]:
    """返回该用户已存的模型配置（api_key 解密）；没有则返回 None。"""
    _ensure_table()
    with get_pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT base_url, model, api_key FROM {_TABLE} WHERE user_key=%s",
                [user_key],
            )
            row = cur.fetchone()
    if not row:
        return None
    base_url, model, api_key = row
    return {
        "base_url": base_url or "",
        "model": model or "",
        "api_key": decrypt(api_key) if api_key else "",
    }


def set_llm_config(
    user_key: str,
    base_url: Optional[str] = None,
    model: Optional[str] = None,
    api_key: Optional[str] = None,
) -> bool:
    """保存该用户的模型配置（upsert）。空字段保留已有值（api_key 留空则不改动已有 Key）。"""
    _ensure_table()
    cur = get_llm_config(user_key) or {}
    final_base = (base_url or "").strip() or (cur.get("base_url") or "")
    final_model = (model or "").strip() or (cur.get("model") or "")
    final_key = (api_key or "").strip() or (cur.get("api_key") or "")
    with get_pool().connection() as conn:
        with conn.cursor() as cur2:
            cur2.execute(
                f"INSERT INTO {_TABLE} (user_key, base_url, model, api_key, updated_at) "
                "VALUES(%s, %s, %s, %s, now()) "
                "ON CONFLICT (user_key) DO UPDATE SET "
                "base_url=EXCLUDED.base_url, model=EXCLUDED.model, "
                "api_key=EXCLUDED.api_key, updated_at=now()",
                [user_key, final_base, final_model, encrypt(final_key) if final_key else ""],
            )
    return True


def resolve_llm_config(user_key: Optional[str] = None, model_id: Optional[str] = None) -> tuple:
    """解析 (api_key|None, base_url, model)。

    优先级：请求指定的 model_id（聊天框选中的模型）> 用户默认模型 > 旧单配置（llm_configs）
    > backend/.env。缺字段逐级用 env 补齐。
    """
    env_key, env_base, env_model = _env_fallback()
    if user_key:
        target = None
        if model_id:
            target = _get_model_plain(user_key, model_id)
        if target is None:
            target = _default_model(user_key)
        if target is None:
            legacy = get_llm_config(user_key)
            if legacy:
                target = legacy
        if target and (target.get("api_key") or target.get("model") or target.get("base_url")):
            return (
                target.get("api_key") or env_key,
                target.get("base_url") or env_base,
                target.get("model") or env_model,
            )
    return _env_fallback()


def mask_key(key: Optional[str]) -> str:
    """把 Key 打码：前3 + 8 个占位 + 后4；太短则全占位。"""
    k = (key or "").strip()
    if not k:
        return ""
    if len(k) <= 8:
        return "•" * len(k)
    return f"{k[:3]}{'•' * 8}{k[-4:]}"


def _one_line(exc: Exception) -> str:
    m = str(exc).strip().splitlines()[0] if str(exc).strip() else type(exc).__name__
    return m[:160]


def _http_detail(r) -> str:
    try:
        j = r.json()
        return str((j.get("error") or {}).get("message") or j.get("message") or r.text).strip()[:160]
    except Exception:
        return str(r.text).strip()[:160]


def test_llm_config(base_url: str, model: str, api_key: str) -> tuple:
    """验证模型服务连通性，返回 (ok, message)。

    优先 `GET {base}/models`（不跑模型，最快最稳，验证地址 + 鉴权）；
    不支持 /models 的服务回退到一次 `max_tokens=1` 的最小补全。
    """
    base_url = (base_url or "").strip() or "https://api.openai.com/v1"
    model = (model or "").strip()
    api_key = (api_key or "").strip()
    if not api_key:
        return False, "缺少 API Key"
    import httpx

    headers = {"Authorization": "Bearer " + api_key}
    root = base_url.rstrip("/")
    # trust_env=False：直连、忽略系统 / 环境变量代理（内网模型服务不经代理）
    try:
        with httpx.Client(timeout=15, trust_env=False) as client:
            r = client.get(root + "/models", headers=headers)
    except Exception as exc:
        return False, f"连接失败：{_one_line(exc)}"

    if r.status_code == 200:
        try:
            ids = [m.get("id") for m in r.json().get("data", []) if isinstance(m, dict)]
        except Exception:
            ids = []
        if model and ids and model not in ids:
            return True, f"连接成功（服务可达；但模型 {model} 不在列表，请核对名称）"
        return True, f"连接成功 · {model or '模型服务'} 可达"
    if r.status_code in (404, 405):
        # 不支持 /models：回退到最小补全
        if not model:
            return False, "缺少模型名称"
        try:
            with httpx.Client(timeout=30, trust_env=False) as client:
                r2 = client.post(
                    root + "/chat/completions",
                    json={"model": model, "messages": [{"role": "user", "content": "hi"}], "max_tokens": 1},
                    headers=headers,
                )
            if r2.status_code == 200:
                return True, f"连接成功 · 模型 {model} 响应正常"
            return False, f"连接失败（HTTP {r2.status_code}）：{_http_detail(r2)}"
        except Exception as exc:
            return False, f"连接失败：{_one_line(exc)}"
    return False, f"连接失败（HTTP {r.status_code}）：{_http_detail(r)}"
