from fastapi import APIRouter, Depends
from pydantic import BaseModel
import time

from assistant_stream import RunController, create_run
from assistant_stream.serialization import AssistantTransportResponse

from app.routers.ask import get_user_key
from app.services.pipeline.clarify import get_pending
from app.services.pipeline.runner import get_history, resume_clarify_stream, run_agent_stream


class AssistantMessagePart(BaseModel):
    type: str
    text: str = ""
    toolCallId: str | None = None
    toolName: str | None = None
    args: dict | None = None
    result: str | None = None
    question: str | None = None
    options: list[dict] | None = None


class AssistantCommand(BaseModel):
    type: str
    message: dict | None = None


class AssistantRequest(BaseModel):
    state: dict | None = None
    commands: list[AssistantCommand] = []
    system: str | None = None
    tools: dict | None = None
    threadId: str | None = None
    dataSourceId: str | None = None
    modelId: str | None = None
    parentId: str | None = None
    callSettings: dict | None = None
    config: dict | None = None


router = APIRouter(prefix="/api", tags=["assistant"])


def _extract_text(message: dict | None) -> str:
    """从 add-message 的 message（{role, parts:[...]}）里取纯文本。"""
    parts = (message or {}).get("parts") or []
    chunks: list[str] = []
    for p in parts:
        if isinstance(p, dict) and p.get("type") == "text" and p.get("text"):
            chunks.append(p["text"])
    return "".join(chunks)


def _history_to_state(history: list[dict]) -> list[dict]:
    """把 checkpointer 里的历史消息转成 state.messages（UI 部分结构）。

    历史消息形如 {role, content, reasoning?, tools?}。转成
    {id, role, content:[{type,...}]}；assistant 优先放 reasoning，再放
    tool-call，最后 text。
    """
    out: list[dict] = []
    for i, m in enumerate(history or []):
        if not isinstance(m, dict):
            continue
        role = m.get("role")
        if role not in ("user", "assistant"):
            continue
        mid = m.get("id") or f"hist-{i}"
        content: list[dict] = []
        if role == "assistant":
            if m.get("reasoning"):
                content.append({"type": "reasoning", "text": m["reasoning"]})
            for t in m.get("tools") or []:
                content.append(
                    {
                        "type": "tool-call",
                        "toolCallId": t.get("id") or f"tool-{time.time_ns()}",
                        "toolName": t.get("name"),
                        "args": t.get("args") or {},
                        "result": t.get("result"),
                    }
                )
            content.append({"type": "text", "text": m.get("content") or ""})
        else:
            content.append({"type": "text", "text": m.get("content") or ""})
        out.append({"id": mid, "role": role, "content": content})
    return out


def _user_message(question: str) -> dict:
    return {
        "id": f"user-{time.time_ns()}",
        "role": "user",
        "content": [{"type": "text", "text": question}],
    }


def _assistant_placeholder() -> dict:
    # 只放 reasoning；text 在首个正文增量出现时再 append（StateProxy 只支持 append/索引，不支持 insert）
    return {
        "id": f"assistant-{time.time_ns()}",
        "role": "assistant",
        "content": [{"type": "reasoning", "text": ""}],
    }


@router.post("/assistant")
async def assistant(
    payload: AssistantRequest,
    user_key: str = Depends(get_user_key),
):
    """assistant-transport 流：处理 add-message，跑 agent，推状态快照。"""

    # 取出待处理的用户问题
    question = ""
    for command in payload.commands or []:
        if command.type == "add-message":
            question = _extract_text(command.message)
    thread_id = payload.threadId or f"anon-{time.time_ns()}"

    async def run_callback(controller: RunController):
        if not question:
            controller.state["isRunning"] = False
            return

        # 若该线程有待澄清状态，则本次 add-message 视为用户选择 -> 流式恢复
        pending = get_pending(thread_id)
        if pending and pending.get("question"):
            event_iter = resume_clarify_stream(thread_id, question, user_key, payload.dataSourceId, payload.modelId)
        else:
            event_iter = run_agent_stream(question, thread_id, user_key, payload.dataSourceId, payload.modelId)

        # 用 checkpointer 历史 + 新消息初始化 state.messages，供前端 1:1 恢复
        history = get_history(thread_id).get("messages") or []
        state_messages = _history_to_state(history) + [_user_message(question)]
        # 助手占位：reasoning + text 两个 part
        state_messages.append(_assistant_placeholder())
        asst_idx = len(state_messages) - 1
        controller.state["messages"] = state_messages
        controller.state["isRunning"] = True
        # 占位 content: [reasoning(0)]；tool/text 都通过 append 追加，text 索引随内容增长
        reasoning_idx = 0
        text_idx = None
        tool_idx = None  # 当前“执行中”工具调用占位在 content 中的索引，用于 running→done 更新

        try:
            async for event in event_iter:
                etype = event.get("type")
                if etype == "reasoning":
                    controller.append_state_text(
                        ["messages", asst_idx, "content", reasoning_idx, "text"],
                        event.get("delta", ""),
                    )
                elif etype == "text":
                    if text_idx is None:
                        content = controller.state["messages"][asst_idx]["content"]
                        text_idx = len(content)
                        content.append({"type": "text", "text": ""})
                    controller.append_state_text(
                        ["messages", asst_idx, "content", text_idx, "text"],
                        event.get("delta", ""),
                    )
                elif etype == "tool":
                    content = controller.state["messages"][asst_idx]["content"]
                    if event.get("result") is None:
                        # 执行中：先追加 tool-call 占位（无结果，前端显示“正在查询…/正在生成图表…”）
                        idx = len(content)
                        content.append(
                            {
                                "type": "tool-call",
                                "toolCallId": f"tool-{time.time_ns()}",
                                "toolName": event.get("name"),
                                "args": event.get("args") or {},
                                "result": None,
                                "phase": event.get("phase") or "query",
                                "status": "running",
                            }
                        )
                        tool_idx = idx
                    else:
                        # 执行完成：更新该 tool-call 占位的结果
                        if tool_idx is not None:
                            content[tool_idx]["result"] = event.get("result")
                            content[tool_idx]["phase"] = event.get("phase") or "query"
                            content[tool_idx]["status"] = "done"
                        tool_idx = None
                elif etype == "clarification":
                    controller.state["messages"][asst_idx]["content"].append(
                        {
                            "type": "clarification",
                            "question": event.get("question"),
                            "options": event.get("options") or [],
                        }
                    )
                    controller.state["clarification"] = event
                elif etype == "chart":
                    controller.state["messages"][asst_idx]["content"].append(
                        {"type": "chart", "spec": event.get("spec") or {}}
                    )
                elif etype == "error":
                    controller.state["messages"][asst_idx]["content"].append(
                        {"type": "text", "text": event.get("error", "")}
                    )
                    controller.add_error(event.get("error", "LLM 调用失败"))
        except Exception as exc:  # pragma: no cover
            controller.add_error(f"LLM 调用失败：{exc}")

        controller.state["isRunning"] = False

    stream = create_run(run_callback, state=payload.state or {"messages": [], "isRunning": False})
    return AssistantTransportResponse(stream)
