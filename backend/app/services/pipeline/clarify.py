"""human-in-the-loop 澄清：由管线检测到口径歧义时暂停并等待用户选择（中间件）。

澄清不再暴露为工具给模型；触发由 `clarify_middleware.detect_clarification` 判定，
暂停/恢复由 `clarify_middleware` 的 LangGraph interrupt / Command(resume) 承担。

这里保留：
- `parse_clarify`：兼容旧「模型调用 clarify 工具」的解析路径。
- `_pending`：进程内按 session_id 暂存「待澄清」状态，供前端展示后恢复。
"""

from __future__ import annotations

from typing import Any, Optional

CLARIFY_NAME = "clarify"


def parse_clarify(call: dict) -> Optional[dict]:
    """从一次工具调用中解析澄清请求；非 clarify 调用或参数不合法时返回 None。"""
    name = call.get("name") or ""
    if name != CLARIFY_NAME:
        return None
    args = call.get("args") or {}
    try:
        question = str(args.get("question") or "").strip()
        options = args.get("options") or []
        if not question or not isinstance(options, list) or len(options) < 2:
            return None
        return {"question": question, "options": [dict(o) for o in options]}
    except Exception:
        return None


# ---- 待澄清状态存储（进程内，按 session_id） ----
_pending: dict[str, dict[str, Any]] = {}


def put_pending(session_id: str, clarification: dict) -> None:
    _pending[session_id] = dict(clarification)


def get_pending(session_id: str) -> Optional[dict]:
    return _pending.get(session_id)


def pop_pending(session_id: str) -> Optional[dict]:
    return _pending.pop(session_id, None)
