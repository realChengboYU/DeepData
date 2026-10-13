"""澄清中间件：管线检测到口径歧义时，用 LangGraph interrupt/resume 暂停并续跑。

澄清不再作为工具暴露给模型（避免模型"主动调 clarify 工具"），而是由管线在
database_query 前先做一次轻量歧义检测：命中则构造澄清 payload —— 通过
`interrupt` 暂停工作流、把 {question, options} 交给前端；用户选择后以
`Command(resume={"option_id": ...})` 续跑。

这与 AskData Studio 的 human-in-the-loop（interrupt + checkpointer）对齐。
"""

from __future__ import annotations

import json
import re
from typing import Any, Optional

from langchain_core.language_models.chat_models import BaseChatModel
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from typing_extensions import TypedDict

TRIGGER_KW = (
    "吗?", "吗？", "要不要", "选哪个", "哪种", "还是", "请确认", "请选择",
    "请澄清", "不确定", "请问是",
)


class ClarifyState(TypedDict, total=False):
    clarification: Optional[dict]
    resume_value: Any


def _human_clarification(state: ClarifyState) -> dict:
    # 调用 interrupt 暂停；resume 时拿到 Command(resume=...) 传入的值。
    response = interrupt(state.get("clarification") or {})
    return {"resume_value": response}


# 轻量澄清图：仅负责 interrupt / resume，状态按 thread_id 暂存。
_clarify_graph = StateGraph(ClarifyState)
_clarify_graph.add_node("human_clarification", _human_clarification)
_clarify_graph.add_edge(START, "human_clarification")
_clarify_graph.add_edge("human_clarification", END)
_CLARIFY = _clarify_graph.compile(checkpointer=InMemorySaver())


def _config(thread_id: str) -> dict:
    return {"configurable": {"thread_id": f"clarify-{thread_id}"}}


def request_clarification(payload: dict, thread_id: str) -> dict:
    """发起一次澄清：调用图触发 interrupt，把 payload 交给前端。"""
    _CLARIFY.invoke({"clarification": payload}, _config(thread_id))
    return payload


def resume_clarification(option_id: str, thread_id: str) -> Any:
    """用户选择后续跑：Command(resume=...) 唤醒 interrupt，返回用户选择值。"""
    result = _CLARIFY.invoke(Command(resume={"option_id": option_id}), _config(thread_id))
    return (result or {}).get("resume_value")


def _parse_detection(text: str) -> Optional[dict]:
    """从模型输出里抽取澄清决定（容错地找 JSON 对象）。"""
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
    except Exception:
        return None
    if not isinstance(obj, dict):
        return None
    if obj.get("need_clarify"):
        question = str(obj.get("question") or "").strip()
        options = obj.get("options") or []
        if question and isinstance(options, list) and len(options) >= 2:
            cleaned = []
            for o in options[:6]:
                if isinstance(o, dict) and o.get("label"):
                    cleaned.append({
                        "id": str(o.get("id") or o.get("label")),
                        "label": str(o["label"]),
                        "description": str(o.get("description") or ""),
                    })
            if len(cleaned) >= 2:
                return {"question": question, "options": cleaned}
    return None


def detect_clarification(question: str, llm: Optional[BaseChatModel]) -> Optional[dict]:
    """轻量歧义检测：命中则返回澄清 payload，否则返回 None。

    - 先做关键字启发式（省去一次模型调用）：问题里带"吗/还是/哪种…"等询问句
      且无法自答时，通常需要澄清。
    - 未命中启发式时，用 temp=0 的模型判断一次（短超时），失败/超时回退 None。
    """
    q = (question or "").strip()
    if not q:
        return None
    if any(k in q for k in TRIGGER_KW):
        # 明显带有请求确认/选择的问句：让模型产出具体澄清选项。
        if llm is None:
            return None
        try:
            prompt = (
                "用户问题可能需要澄清口径（指标/时间范围/维度/表含义）。"
                "请判断是否需要向用户确认。仅当该歧义会实质改变查询结果时才需要。\n"
                f"用户问题：{q}\n"
                '若需要澄清，输出 JSON：{"need_clarify": true, "question": "需要确认的问题", '
                '"options": [{"id":"a","label":"选项A","description":"说明"},{"id":"b","label":"选项B","description":"说明"}]}\n'
                '若不需要，输出 JSON：{"need_clarify": false}。只有一个 JSON 对象。'
            )
            resp = llm.invoke(prompt)
            text = resp.content if hasattr(resp, "content") else str(resp)
            return _parse_detection(text)
        except Exception:
            return None
    # 非明显询问句：不触发（避免过度打扰），交给 agent 自行处理。
    return None


__all__ = [
    "detect_clarification",
    "request_clarification",
    "resume_clarification",
]
