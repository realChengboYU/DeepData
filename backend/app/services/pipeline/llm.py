"""LLM 工厂：读取 OpenAI 兼容配置；未配置 key 时返回 None（调用方降级提示）。

使用 langchain 的 ChatDeepSeek（而不是 base ChatOpenAI）：因为 base ChatOpenAI
只按官方 OpenAI 规范解析响应，不会提取第三方代理返回的非标准字段
`reasoning_content`（模型 thinking）。ChatDeepSeek 会把 thinking 归一化成
AIMessage.content_blocks 里的 `reasoning` 内容块，可随 llm.stream() 逐 chunks 拿到。
"""

import os
from typing import Optional, Sequence

from dotenv import load_dotenv

from app.prompt import build_messages

load_dotenv()  # 加载 backend/.env（LLM 配置）

# 本环境的 HTTP 客户端（httpx2 / httpx）会在设置了代理相关环境变量时，因解析其中的
# IPv6 条目（NO_PROXY 里的 `::1,[::1]`）而崩溃（Invalid port）或无法直连内网 LLM。
# 这里在进程内清除代理环境变量，让 LLM 客户端直接访问内网模型服务（局域网，无需走系统代理）。
for _k in (
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
    "http_proxy", "https_proxy", "all_proxy",
    "NO_PROXY", "no_proxy",
):
    os.environ.pop(_k, None)

# LLM 请求超时（秒）。默认 60：模型服务偶发慢时不至于冻住整个对话太久；
# 可通过 .env 的 LLM_TIMEOUT 调整。
LLM_TIMEOUT = int(os.getenv("LLM_TIMEOUT", "60"))


def _env() -> tuple:
    """读取（api_key, base_url, model）。"""
    api_key = os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY") or os.getenv("DEEPSEEK_API_KEY")
    base_url = os.getenv("LLM_BASE_URL") or os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1"
    model = os.getenv("LLM_MODEL") or os.getenv("LLM_MODEL_ID") or "gpt-4o-mini"
    return api_key, base_url, model


def get_llm() -> Optional["object"]:
    """构造 ChatDeepSeek（可提取 reasoning_content 为 content_blocks）。

    未配置 key 时返回 None（调用方降级提示）。
    """
    api_key, base_url, model = _env()
    if not api_key:
        return None
    try:
        from langchain_deepseek import ChatDeepSeek
    except Exception:  # pragma: no cover - 包未装时降级
        return None
    return ChatDeepSeek(
        model=model,
        api_key=api_key,
        base_url=base_url,
        temperature=0.3,
        timeout=LLM_TIMEOUT,
    )


def _blocks_to_text(blocks) -> tuple:
    """从 content_blocks 中拆分出 (answer, reasoning)。

    reasoning 块有 type=="reasoning" 且带 reasoning 字段；text 块 type=="text" 且带 text。
    """
    reasoning_parts: list[str] = []
    text_parts: list[str] = []
    for b in blocks or []:
        t = b.get("type") if isinstance(b, dict) else getattr(b, "type", None)
        if t == "reasoning":
            reasoning_parts.append(b.get("reasoning", "") if isinstance(b, dict) else getattr(b, "reasoning", ""))
        elif t == "text":
            text_parts.append(b.get("text", "") if isinstance(b, dict) else getattr(b, "text", ""))
    return "".join(text_parts), "".join(reasoning_parts)


def chat_completion(
    conversation: list,
    model: Optional[str] = None,
    skill_instructions: Optional[str] = None,
) -> dict:
    """一次多轮对话的 LLM 调用：用 llm.stream() 拿到 answer + thinking（reasoning_content）。

    返回 dict：{"content": str, "reasoning_content": str, "error": str|None}
    """
    try:
        from langchain_deepseek import ChatDeepSeek
    except Exception:
        return {"content": "（未安装 langchain-deepseek）", "reasoning_content": "", "error": None}

    api_key, base_url, _ = _env()
    if not api_key:
        return {"content": "（未配置 LLM：请在 backend/.env 设置 LLM_API_KEY）", "reasoning_content": "", "error": None}
    m = model or os.getenv("LLM_MODEL") or os.getenv("LLM_MODEL_ID") or "gpt-4o-mini"

    # 构造发给 LLM 的消息列表：system 提示 + 历史(仅 role/content)
    # skill_instructions 可选：某 Skill 的 SKILL.md 指令文本，运行时拼接到 system 末尾。
    messages = build_messages(conversation, skill_instructions=skill_instructions)

    try:
        llm = ChatDeepSeek(model=m, api_key=api_key, base_url=base_url, temperature=0.3, timeout=LLM_TIMEOUT)
        text_parts: list[str] = []
        reasoning_parts: list[str] = []
        for chunk in llm.stream(messages):
            text, reasoning = _blocks_to_text(getattr(chunk, "content_blocks", None))
            text_parts.append(text)
            reasoning_parts.append(reasoning)
        return {"content": "".join(text_parts), "reasoning_content": "".join(reasoning_parts), "error": None}
    except Exception as exc:  # LLM 调用失败
        return {"content": "", "reasoning_content": "", "error": str(exc)}


def _invoke_tool(tools: list, tool_call: dict) -> str:
    """按 tool_call 的名字在工具列表中找到并执行，返回字符串结果。"""
    name = tool_call.get("name") or ""
    args = tool_call.get("args") or {}
    for t in tools or []:
        if getattr(t, "name", None) == name:
            try:
                if callable(getattr(t, "invoke", None)):
                    return str(t.invoke(args))
                return str(t.run(args)) if callable(getattr(t, "run", None)) else str(t)
            except Exception as exc:
                return f"（工具 {name} 执行失败：{exc}）"
    return f"（未知工具：{name}）"


def chat_with_tools(
    llm,
    tools: list,
    conversation: list,
    max_iters: int = 5,
    skill_instructions: Optional[str] = None,
    allowed_tools: Optional[Sequence[str]] = None,
) -> tuple:
    """绑定 SQL 工具的多轮对话：LLM -> tool_calls -> 工具结果回填 -> LLM（最多 max_iters 轮）。

    - skill_instructions：某 Skill 的 SKILL.md 指令文本，拼接到 system 末尾。
    - allowed_tools：该 Skill 允许的工具白名单；提供时先按名字收敛工具面（防御：模型只会看到/调用允许的工具）。
    返回 (answer, reasoning, tool_events, error)。
    """
    if allowed_tools is not None:
        tool_names = set(allowed_tools)
        tools = [t for t in tools if getattr(t, "name", None) in tool_names]
    bound = llm.bind_tools(tools)
    messages = build_messages(conversation, skill_instructions=skill_instructions)
    text_parts: list[str] = []
    reasoning_parts: list[str] = []
    tool_events: list[dict] = []
    try:
        for _ in range(max_iters + 1):
            msg = bound.invoke(messages)
            text, reasoning = _blocks_to_text(getattr(msg, "content_blocks", None))
            if text:
                text_parts.append(text)
            if reasoning:
                reasoning_parts.append(reasoning)
            tool_calls = getattr(msg, "tool_calls", None) or []
            if not tool_calls:
                break
            # 逐条执行工具调用，并把结果以 role=tool 回填给模型
            for tc in tool_calls:
                result = _invoke_tool(tools, tc)
                tool_events.append({"name": tc.get("name"), "args": tc.get("args"), "result": result})
                messages.append({
                    "role": "tool",
                    "content": result,
                    "tool_call_id": tc.get("id") or "",
                    "name": tc.get("name") or "",
                })
        return "".join(text_parts), "".join(reasoning_parts), tool_events, None
    except Exception as exc:  # 工具/LLM 调用失败
        return "".join(text_parts), "".join(reasoning_parts), tool_events, str(exc)
