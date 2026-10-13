"""
对话管线（pipeline）的运行入口：一次多轮流式对话。

对外暴露 `run_agent_stream(question, session_id, user_key) -> AsyncIterator[dict]`，
逐块产出 reasoning / text / tool / clarification / chart / error / done 事件。
"""

import asyncio
import hashlib
import json
import os
import time
import uuid
from typing import AsyncIterator, Optional

from openai import APITimeoutError, APIStatusError

from app.datasource.pg import PG_CONNECTION_STRING
from app.prompt import build_messages
from app.services import datasource_store as ds
from app.services import llm_store
from app.services.pipeline.chart import (
    build_spec_from_tool_events,
    is_chart_call,
    make_chart_tool,
    normalize_chart_spec,
    wants_chart,
)
from app.services.pipeline.clarify import (
    get_pending,
    parse_clarify,
    pop_pending,
    put_pending,
)
from app.services.pipeline.clarify_middleware import (
    detect_clarification,
    request_clarification,
    resume_clarification,
)
from app.services.pipeline.time import make_time_tool
from app.services.pipeline.graph import _GRAPH
from app.services.pipeline.llm import LLM_TIMEOUT, _invoke_tool
from app.services.pipeline.router import (
    has_recent_result,
    recent_result_context,
    route_intent,
)
from app.services.schema_index import get_schema_context
from app.skills import get_skill_context
from app.tools.SQLTools.sql_tools import get_sql_tools

# 模型在推理/回答里表达「想可视化」的意图词（用户问题未必带图关键词，如“按供应商统计”）。
_CHART_INTENT_WORDS = ("可视化", "柱状图", "折线图", "饼图", "条形图", "图表", "画图", "画个图", "展示数据", "柱图", "趋势图")


def _text_wants_chart(text: str) -> bool:
    return bool(text) and any(w in text for w in _CHART_INTENT_WORDS)


# 结果缓存（C）：对「同一工具 + 同一参数」的调用结果做短 TTL 缓存。
# 同一问题重复提问会生成相同的 SQL，命中缓存后可直接复用，避免重复查库 / 重复生成。
_TOOL_CACHE_TTL = float(os.getenv("TOOL_CACHE_TTL", "60"))
_TOOL_CACHE: dict[str, tuple[float, str]] = {}


def _tool_cache_key(name: str, args: dict) -> str:
    try:
        payload = json.dumps(args or {}, sort_keys=True, ensure_ascii=False)
    except Exception:
        payload = str(args or {})
    return f"{name}:{hashlib.md5(payload.encode('utf-8')).hexdigest()}"


def _cached_invoke_tool(tools: list, call: dict) -> str:
    """执行工具，命中 TTL 缓存时直接返回；否则执行并入缓存。"""
    name = call.get("name") or ""
    args = call.get("args") or {}
    key = _tool_cache_key(name, args)
    now = time.monotonic()
    cached = _TOOL_CACHE.get(key)
    if cached is not None and cached[0] > now:
        return cached[1]
    result = _invoke_tool(tools, call)
    _TOOL_CACHE[key] = (now + _TOOL_CACHE_TTL, result)
    return result


async def _invoke_tools_parallel(tools: list, calls: list) -> tuple[list[str], list[float]]:
    """并行执行多个互相独立的工具调用（B），用线程池跑同步工具，保持调用顺序。

    返回 (结果列表, 每个调用的耗时(毫秒))，供前端展示「SQL 查询耗时」等真实耗时。
    """
    results: list[str] = [""] * len(calls)
    elapsed: list[float] = [0.0] * len(calls)
    sem = asyncio.Semaphore(4)  # 限制并发，避免一次性打爆数据源

    async def _run(i: int, call: dict) -> None:
        async with sem:
            t0 = time.monotonic()
            results[i] = await asyncio.to_thread(_cached_invoke_tool, tools, call)
            elapsed[i] = (time.monotonic() - t0) * 1000

    await asyncio.gather(*[_run(i, call) for i, call in enumerate(calls)])
    return results, elapsed


def _accumulate_tool_calls(tool_call_chunks: list) -> list:
    """把 astream 的 tool_call_chunks 分片按 index 合并成完整 tool_calls。"""
    groups: dict = {}
    for c in tool_call_chunks or []:
        idx = c.get("index", 0)
        g = groups.setdefault(idx, {"name": None, "args": "", "id": None})
        if c.get("name"):
            g["name"] = c["name"]
        if c.get("id"):
            g["id"] = c["id"]
        if c.get("args"):
            g["args"] += c["args"]
    calls = []
    for idx in sorted(groups):
        g = groups[idx]
        if not g["name"]:
            continue
        try:
            args = json.loads(g["args"]) if g["args"] else {}
        except Exception:
            args = {}
        calls.append({"name": g["name"], "args": args, "id": g["id"] or "", "type": "tool_call"})
    return calls


async def _agent_stream(llm, tools: list, messages: list, max_iters: int = 8, state: dict | None = None):
    """绑定工具的多轮流式生成（支持 clarify / render_chart）。

    yield 事件：{"type":"reasoning","delta"} | {"type":"text","delta"}
              | {"type":"tool",name,args,result} | {"type":"clarification",question,options}
              | {"type":"chart","spec":{...}}
    当模型调用 clarify 工具时，不再执行其它调用，直接产出 clarification 事件并暂停；
    render_chart 被拦截（记录 spec 并产出 chart 事件），模型随后继续给出文字解读。
    state（可选）用于把「模型是否尝试过 render_chart」回传给调用方，供兜底判断。
    """
    bound = llm.bind_tools(tools)
    chart_yielded = False
    for _ in range(max_iters + 1):
        tcc: list = []
        # 模型网关偶发慢/5xx：对单轮 LLM 调用做重试（默认最多 3 次，递增退避），
        # 扛住瞬时 502/503。重试会重新生成增量，偶发重复可接受。
        max_attempts = int(os.getenv("LLM_RETRY_ATTEMPTS", "3"))
        for attempt in range(max_attempts):
            try:
                async for chunk in bound.astream(messages):
                    for b in (getattr(chunk, "content_blocks", None) or []):
                        t = b.get("type") if isinstance(b, dict) else getattr(b, "type", None)
                        if t == "reasoning":
                            delta = b.get("reasoning", "") if isinstance(b, dict) else getattr(b, "reasoning", "")
                            if delta:
                                yield {"type": "reasoning", "delta": delta}
                        elif t == "text":
                            delta = b.get("text", "") if isinstance(b, dict) else getattr(b, "text", "")
                            if delta:
                                yield {"type": "text", "delta": delta}
                    tcc_chunks = getattr(chunk, "tool_call_chunks", None)
                    if tcc_chunks:
                        tcc.extend(tcc_chunks)
                break
            except (APITimeoutError, TimeoutError, APIStatusError) as exc:
                should_retry = True
                if isinstance(exc, APIStatusError):
                    code = getattr(exc, "status_code", None)
                    should_retry = code is not None and int(code) >= 500
                if attempt < max_attempts - 1 and should_retry:
                    tcc = []
                    await asyncio.sleep(1.5 * (attempt + 1))
                    continue
                raise
        calls = _accumulate_tool_calls(tcc)
        if not calls:
            break
        clarification = None
        chart_calls: list = []
        query_calls: list = []
        for call in calls:
            if is_chart_call(call):
                chart_calls.append(call)
                continue
            cl = parse_clarify(call)
            if cl is not None:
                if clarification is None:
                    clarification = cl
                continue
            query_calls.append(call)

        # 图表调用：被拦截（不真正执行工具），只发 running → chart → done
        for call in chart_calls:
            args = call.get("args") or {}
            yield {"type": "tool", "name": call["name"], "args": args,
                   "result": None, "phase": "chart", "status": "running"}
            # 让前端先收到 running 帧，再继续（否则会被并到同一个 update-state，看不到加载态）
            await asyncio.sleep(0)
            if state is not None:
                state["chart_attempted"] = True
            if not chart_yielded:
                spec = normalize_chart_spec(args)
                if spec:
                    yield {"type": "chart", "spec": spec}
                    chart_yielded = True
            messages.append({
                "role": "tool",
                "content": "图表已生成并在界面中展示给用户，请用文字解读结果。",
                "tool_call_id": call["id"],
                "name": call["name"],
            })
            yield {"type": "tool", "name": call["name"], "args": args,
                   "result": "图表已生成", "phase": "chart", "status": "done"}

        # 数据库查询（B：并行执行互不依赖的工具）：
        # 先全部发 running（前端同时显示多个进行中），再并行执行并统一回填结果。
        if query_calls:
            for call in query_calls:
                args = call.get("args") or {}
                yield {"type": "tool", "name": call["name"], "args": args,
                       "result": None, "phase": "query", "status": "running"}
            # 让前端先收到 running 帧，再执行工具（否则会被并到同一个 update-state，看不到加载态）
            await asyncio.sleep(0)
            try:
                results, elapsed = await _invoke_tools_parallel(tools, query_calls)
            except Exception as exc:  # 工具执行失败也不能挂起流（否则前端停在思考）
                results = [f"工具执行失败：{exc}"] * len(query_calls)
                elapsed = [0.0] * len(query_calls)
            for i, (call, result) in enumerate(zip(query_calls, results)):
                args = call.get("args") or {}
                yield {"type": "tool", "name": call["name"], "args": args,
                       "result": result, "phase": "query", "status": "done",
                       "elapsed_ms": int(elapsed[i])}
                messages.append({
                    "role": "tool",
                    "content": result,
                    "tool_call_id": call["id"],
                    "name": call["name"],
                })

        if clarification is not None:
            yield {"type": "clarification", **clarification}
            return


async def run_agent_stream(
    question: str,
    session_id: Optional[str] = None,
    user_key: Optional[str] = None,
    data_source_id: Optional[str] = None,
    model_id: Optional[str] = None,
) -> AsyncIterator[dict]:
    """流式多轮对话：逐块返回模型 thinking / answer 增量（SSE 事件），并在结束时持久化会话。

    若配置了数据源，智能体绑定 SQLDatabaseToolkit 工具；模型需查询数据库时会输出工具调用信息。
    事件形状：
      {"type":"reasoning","delta":str}   模型思考增量
      {"type":"text","delta":str}        回答增量
      {"type":"tool","name","args","result"}  工具调用信息
      {"type":"error","error":str}       出错
      {"type":"done","answer","reasoning","tools","session_id"}  完成
    """
    q = (question or "").strip()
    if not q:
        yield {"type": "error", "error": "请输入内容后再发送。", "session_id": session_id}
        return

    thread_id = session_id or f"anon-{uuid.uuid4().hex}"
    config = {"configurable": {"thread_id": thread_id}}

    try:
        history = get_history(thread_id).get("messages") or []
    except Exception:  # pragma: no cover
        history = []

    reasoning_parts: list[str] = []
    text_parts: list[str] = []
    tool_events: list[dict] = []
    chart_events: list[dict] = []
    clarification_requested: Optional[dict] = None
    agent_state: dict = {"chart_attempted": False}
    thinking_started: Optional[float] = None  # 首个 reasoning 增量出现时刻
    thinking_end: Optional[float] = None      # 首个 text/tool 增量出现时刻（思考阶段结束）
    answer = ""
    reasoning = ""

    try:
        from langchain_deepseek import ChatDeepSeek

        # 模型解析：聊天框显式选择的 model_id > 用户默认模型 > 旧单配置 > backend/.env
        api_key, base_url, model = llm_store.resolve_llm_config(user_key or "anonymous", model_id)
        if not api_key:
            raise RuntimeError("未配置对话模型：请在「设置」里配置模型（URL/名称/Key），或在 backend/.env 设置 LLM_API_KEY")
        llm = ChatDeepSeek(model=model, api_key=api_key, base_url=base_url, temperature=0.3, timeout=LLM_TIMEOUT)
        # Schema 精排 / 澄清检测用「专用小模型」（设置里可选），temp=0 更稳定；未选则跟随对话主模型。
        # 精排是轻量筛选，给短超时（默认 15s）避免模型偶发慢时拖住整个流；超时则回退未精排。
        rerank_key, rerank_base, rerank_model = llm_store.resolve_rerank_config(user_key or "anonymous", model_id)
        rerank_llm = ChatDeepSeek(
            model=rerank_model, api_key=rerank_key, base_url=rerank_base,
            temperature=0.0, timeout=int(os.getenv("RERANK_TIMEOUT", "15")),
        )
        # 数据源解析优先级：本次请求显式指定的 data_source_id（会话绑定的源）
        # > 该会话已绑定的数据源 > 用户「使用中」的数据源 > 环境变量 PG_CONNECTION_STRING。
        # 若本次带了 data_source_id，则同步持久化为该会话的绑定（供刷新 / 后续消息恢复）。
        db_url = None
        try:
            target = (data_source_id or get_session_data_source(thread_id) or None)
            if target:
                db_url = ds.get_db_url_for(user_key or "anonymous", target)
            if not db_url:
                db_url = ds.get_active_db_url(user_key or "anonymous")
            if data_source_id:
                set_session_data_source(thread_id, data_source_id)
        except Exception:
            db_url = None
        if not db_url:
            db_url = PG_CONNECTION_STRING
        tools = get_sql_tools(llm, db_url=db_url)
        route = route_intent(q, bool(tools), has_recent_result(history))

        # 意图识别先行：先判断用户意图/是否需要澄清，再决定是否需要召回 schema（需要才召回）。
        # 所以 schema 召回移到 database_query 分支内、澄清判断之后执行（见下方）。

        if route == "database_query":
            # 查询能力走 database_query Skill：注入 SKILL.md 指令 + 按 allowed_tools 收敛工具面。
            # 澄清由管线做（中间件），不再把 clarify 暴露为工具给模型。
            skill_instructions, allowed_tools = get_skill_context("database_query")
            tool_names = set(allowed_tools or [])
            sql_tools = [t for t in tools if getattr(t, "name", None) in tool_names]
            bind_tools = list(sql_tools) + [make_chart_tool(), make_time_tool()]

            # 澄清中间件：先做轻量歧义检测，命中则 interrupt 暂停工作流、把澄清交前端，等待 resume。
            # 检测会临时调一次模型（temp=0，同步阻塞），用线程跑避免卡住事件循环；失败/超时回退“不澄清”。
            try:
                clarify_payload = await asyncio.to_thread(detect_clarification, q, rerank_llm)
            except Exception:
                clarify_payload = None
            if clarify_payload:
                try:
                    request_clarification(clarify_payload, thread_id)
                except Exception:
                    pass  # 中断图初始化失败则继续走正常流程
                put_pending(thread_id, clarify_payload)  # 供 assistant 路由判断本线程“有待澄清”

                # 把澄清以 ask-question 代码块注入助手文本，前端 MarkdownText 渲染成可点击选项。
                ask_options = []
                for o in clarify_payload.get("options") or []:
                    ask_options.append({
                        "label": o.get("label", ""),
                        "prompt": o.get("label", ""),
                        "preferred": bool(o.get("preferred")),
                    })
                ask_json = json.dumps(
                    {"question": clarify_payload.get("question", ""), "options": ask_options},
                    ensure_ascii=False,
                )
                ask_block = f"```ask-question\n{ask_json}\n```"
                yield {"type": "text", "delta": ask_block}

                # 持久化：用户问题 + 带 ask-question 块的助手消息（供历史恢复）
                try:
                    full = history + [
                        {"role": "user", "content": q},
                        {"role": "assistant", "content": ask_block,
                         "reasoning": "", "tools": [], "charts": [],
                         "thinking_ms": 0, "clarification": True},
                    ]
                    _GRAPH.update_state(config, {"messages": full})
                except Exception:
                    pass

                yield {
                    "type": "done",
                    "answer": ask_block,
                    "reasoning": [],
                    "tools": [],
                    "thinking_ms": 0,
                    "session_id": thread_id,
                    "pending_clarification": clarify_payload,
                }
                return

            # 意图确认不需要澄清，才召回 schema（仅当命中数据源时）；未就绪/失败时为空，不影响对话。
            schema_context = ""
            if target:
                # 精排会再调一次模型（temp=0，同步阻塞），用线程跑避免卡住事件循环。
                _, schema_context = await asyncio.to_thread(
                    get_schema_context, target, user_key or "anonymous", q, 10, rerank_llm
                )

            messages = build_messages(
                history, question=q, skill_instructions=skill_instructions,
                schema_context=schema_context,
            )
            async for ev in _agent_stream(llm, bind_tools, messages, max_iters=10, state=agent_state):
                if ev["type"] == "reasoning":
                    if thinking_started is None:
                        thinking_started = time.monotonic()
                    reasoning_parts.append(ev["delta"])
                elif ev["type"] == "text":
                    if thinking_started is not None and thinking_end is None:
                        thinking_end = time.monotonic()
                    text_parts.append(ev["delta"])
                elif ev["type"] == "tool":
                    if thinking_started is not None and thinking_end is None:
                        thinking_end = time.monotonic()
                    # 只收集带结果的事件（running 占位无 result，跳过以避免污染图表兜底解析）
                    if ev.get("result") is not None:
                        tool_events.append(ev)
                elif ev["type"] == "chart":
                    chart_events.append(ev.get("spec") or {})
                elif ev["type"] == "clarification":
                    clarification_requested = ev
                yield ev
        elif route == "data_qa":
            # data_qa：复用已有查询结果，绑定 chart 工具让模型可视化
            skill_instructions, _ = get_skill_context("data_qa")
            rec = recent_result_context(history)
            user_content = f"{q}\n\n[已有查询结果]\n{rec}" if rec else q
            messages = build_messages(history, question=user_content, skill_instructions=skill_instructions)
            async for ev in _agent_stream(llm, [make_chart_tool()], messages, max_iters=6, state=agent_state):
                if ev["type"] == "reasoning":
                    if thinking_started is None:
                        thinking_started = time.monotonic()
                    reasoning_parts.append(ev["delta"])
                elif ev["type"] == "text":
                    if thinking_started is not None and thinking_end is None:
                        thinking_end = time.monotonic()
                    text_parts.append(ev["delta"])
                elif ev["type"] == "tool":
                    if thinking_started is not None and thinking_end is None:
                        thinking_end = time.monotonic()
                    # 只收集带结果的事件（running 占位无 result，跳过以避免污染图表兜底解析）
                    if ev.get("result") is not None:
                        tool_events.append(ev)
                elif ev["type"] == "chart":
                    chart_events.append(ev.get("spec") or {})
                elif ev["type"] == "clarification":
                    clarification_requested = ev
                yield ev
        else:
            # direct_response：不绑定工具，纯对话
            messages = build_messages(history, question=q)
            async for chunk in llm.astream(messages):
                for b in (getattr(chunk, "content_blocks", None) or []):
                    t = b.get("type") if isinstance(b, dict) else getattr(b, "type", None)
                    if t == "reasoning":
                        delta = b.get("reasoning", "") if isinstance(b, dict) else getattr(b, "reasoning", "")
                        if delta:
                            reasoning_parts.append(delta)
                            yield {"type": "reasoning", "delta": delta}
                    elif t == "text":
                        delta = b.get("text", "") if isinstance(b, dict) else getattr(b, "text", "")
                        if delta:
                            text_parts.append(delta)
                            yield {"type": "text", "delta": delta}
    except Exception as exc:
        import traceback as _tb
        print(f"[run_agent_stream] LLM 调用失败: {exc}\n{_tb.format_exc()}", flush=True)
        yield {"type": "error", "error": f"LLM 调用失败：{exc}"}
        return

    answer = "".join(text_parts)
    reasoning = "".join(reasoning_parts)
    thinking_ms = 0
    if thinking_started is not None:
        # 注意优先级：`or` 低于 `-`，必须先把基准求出来再减，否则会误用
        # thinking_end（time.monotonic() 的绝对秒数）当作时长。
        thinking_ms = int(((thinking_end or time.monotonic()) - thinking_started) * 1000)

    # 确定性兜底：用户要图（或模型尝试过 render_chart，或模型在推理/回答里表达了可视化意向）
    # 但没产出可用 chart 时，从最后一个表格型查询结果构建 spec。
    if (wants_chart(q) or agent_state.get("chart_attempted") or _text_wants_chart(reasoning + answer)) and not chart_events:
        try:
            spec = build_spec_from_tool_events(tool_events, q)
        except Exception:
            spec = None  # 兜底解析失败绝不能中断流（否则前端停在思考）
        if spec:
            chart_events.append(spec)
            yield {"type": "chart", "spec": spec}

    # 需要澄清：暂停并记录待澄清状态，不产出最终答案
    if clarification_requested is not None:
        put_pending(thread_id, clarification_requested)
        try:
            full = history + [
                {"role": "user", "content": q},
                {"role": "assistant", "content": answer or clarification_requested.get("question", ""),
                 "reasoning": reasoning, "tools": tool_events, "charts": chart_events,
                 "thinking_ms": thinking_ms, "clarification": True},
            ]
            _GRAPH.update_state(config, {"messages": full})
        except Exception:
            pass
        yield {
            "type": "done",
            "answer": answer,
            "reasoning": [reasoning] if reasoning else [],
            "tools": tool_events,
            "thinking_ms": thinking_ms,
            "session_id": thread_id,
            "pending_clarification": clarification_requested,
        }
        return

    # 持久化会话（含 reasoning 与 tools，供刷新 / 历史恢复），不重复调用 LLM
    try:
        full = history + [
            {"role": "user", "content": q},
            {"role": "assistant", "content": answer, "reasoning": reasoning,
             "tools": tool_events, "charts": chart_events, "thinking_ms": thinking_ms},
        ]
        _GRAPH.update_state(config, {"messages": full})
    except Exception:
        pass

    yield {
        "type": "done",
        "answer": answer,
        "reasoning": [reasoning] if reasoning else [],
        "tools": tool_events,
        "thinking_ms": thinking_ms,
        "session_id": thread_id,
    }


def _resolve_option(pending: dict, option_label: str) -> dict:
    """按 label / id 匹配澄清选项；找不到时回退到第一个选项。"""
    raw = str(option_label or "").strip()
    # 去掉可能的“我选择：”前缀，便于前端直接回传 label 也能命中
    if "：" in raw:
        raw = raw.rsplit("：", 1)[-1].strip()
    options = pending.get("options") or []
    sel = next((o for o in options if str(o.get("label")) == raw), None)
    if sel is None:
        sel = next((o for o in options if str(o.get("id")) == raw), None)
    if sel is None:
        sel = next((o for o in options if raw in str(o.get("label"))), None)
    if sel is None:
        sel = options[0] if options else {"id": raw, "label": raw}
    return sel


async def resume_clarify_stream(
    session_id: Optional[str],
    option_label: str,
    user_key: Optional[str] = None,
    data_source_id: Optional[str] = None,
    model_id: Optional[str] = None,
) -> AsyncIterator[dict]:
    """用户对澄清选择后的流式恢复。

    clarify 分支已把「问题 + ask-question 块」持久化到 checkpointer，这里只唤醒
    interrupt 并以新一问续跑；本轮（用户选择 + 回答）由 run_agent_stream 在结尾持久化。
    复用 run_agent_stream 的流式事件（reasoning / text / tool / clarification / error / done）。
    """
    if not session_id:
        yield {"type": "error", "error": "缺少会话 id"}
        return
    pending = pop_pending(session_id) or {}
    if not pending.get("question"):
        yield {"type": "error", "error": "没有待澄清的问题"}
        return
    selected = _resolve_option(pending, option_label)
    label = selected.get("label") or str(selected.get("id"))
    option_id = str(selected.get("id"))

    # 澄清中间件：用 Command(resume=...) 唤醒 interrupt，完成暂停->恢复。
    try:
        resume_clarification(option_id, session_id)
    except Exception:
        pass

    # 历史已在 clarify 分支持久化（含 ask-question 块），这里直接以新一问续跑，
    # run_agent_stream 会在结尾把本轮（用户选择 + 回答）持久化到 checkpointer。
    async for ev in run_agent_stream(f"基于我选择「{label}」，请继续。", session_id, user_key, data_source_id, model_id):
        yield ev


def get_history(session_id: Optional[str] = None) -> dict:
    """读取某会话的历史消息（来自 checkpointer 的短期记忆）。"""
    if not session_id:
        return {"session_id": None, "messages": []}
    messages = []
    try:
        from app.services.memory import get_checkpointer
        cp = get_checkpointer()
        tup = cp.get_tuple({"configurable": {"thread_id": session_id}})
        if tup is not None:
            cv = (tup.checkpoint or {}).get("channel_values") or {}
            messages = cv.get("messages") or []
    except Exception:
        messages = []
    return {"session_id": session_id, "messages": messages}


def list_sessions(limit: int = 50) -> list[dict]:
    """枚举所有历史会话（去重 thread_id），按最近更新倒序。

    返回 [{session_id, title, updated_at, message_count}]。标题取该会话首条用户消息。
    """
    sessions = []
    try:
        from app.services.memory import get_checkpointer, get_connection
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT DISTINCT thread_id FROM checkpoints WHERE thread_id IS NOT NULL"
                )
                thread_ids = [r[0] for r in cur.fetchall()]
        cp = get_checkpointer()
        for tid in thread_ids:
            msgs: list = []
            ts: Optional[str] = None
            try:
                tup = cp.get_tuple({"configurable": {"thread_id": tid}})
                if tup is not None:
                    cv = (tup.checkpoint or {}).get("channel_values") or {}
                    msgs = cv.get("messages") or []
                    ts = (tup.checkpoint or {}).get("ts")
            except Exception:
                msgs = []
                ts = None
            title = ""
            for m in msgs:
                if isinstance(m, dict) and m.get("role") == "user":
                    text = (m.get("content") or "").strip()
                    if text:
                        title = text[:30]
                        break
            stored = _stored_session_title(tid)
            if stored:
                title = stored
            sessions.append(
                {
                    "session_id": tid,
                    "title": title or "（新会话）",
                    "updated_at": ts,
                    "message_count": len(msgs),
                    "data_source_id": get_session_data_source(tid),
                }
            )
        sessions.sort(key=lambda s: (s["updated_at"] or ""), reverse=True)
        return sessions[:limit]
    except Exception:
        return sessions[:limit]


def delete_session(session_id: Optional[str] = None) -> bool:
    """删除某会话的所有 checkpoint（短期记忆），会连同历史一起清掉。"""
    if not session_id:
        return False
    try:
        from app.services.memory import get_connection
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM checkpoints WHERE thread_id = %s", [session_id])
                try:
                    cur.execute("DELETE FROM checkpoint_writes WHERE thread_id = %s", [session_id])
                except Exception:
                    pass
        return True
    except Exception:
        return False


def _stored_session_title(session_id: str) -> str:
    """读取用户为会话自定义的标题（存于 langgraph_store 的 session_meta/history 命名空间）。"""
    try:
        from app.services.memory import get_store
        item = get_store().get(("session_meta", "history"), session_id)
        if item is not None and isinstance(item.value, dict):
            return str(item.value.get("title") or "").strip()
    except Exception:
        pass
    return ""


def rename_session(session_id: Optional[str] = None, title: Optional[str] = None) -> bool:
    """为会话设置自定义标题；空标题清空（回退为首条用户消息）。保留 data_source_id 等其它元数据。"""
    if not session_id:
        return False
    try:
        from app.services.memory import get_store
        store = get_store()
        item = store.get(("session_meta", "history"), session_id)
        val = dict(item.value) if item is not None and isinstance(item.value, dict) else {}
        val["title"] = (title or "").strip()
        store.put(("session_meta", "history"), session_id, val)
        return True
    except Exception:
        return False


def get_session_data_source(session_id: Optional[str] = None) -> Optional[str]:
    """读取某会话绑定的数据源 id（存于 session_meta）；没有则返回 None。"""
    if not session_id:
        return None
    try:
        from app.services.memory import get_store
        item = get_store().get(("session_meta", "history"), session_id)
        if item is not None and isinstance(item.value, dict):
            return str(item.value.get("data_source_id") or "").strip() or None
    except Exception:
        pass
    return None


def set_session_data_source(session_id: Optional[str] = None, data_source_id: Optional[str] = None) -> bool:
    """设置某会话绑定的数据源 id（保留 title 等其它元数据）；传空则清除绑定。"""
    if not session_id:
        return False
    try:
        from app.services.memory import get_store
        store = get_store()
        item = store.get(("session_meta", "history"), session_id)
        val = dict(item.value) if item is not None and isinstance(item.value, dict) else {}
        sid = (data_source_id or "").strip() or None
        if sid:
            val["data_source_id"] = sid
        else:
            val.pop("data_source_id", None)
        store.put(("session_meta", "history"), session_id, val)
        return True
    except Exception:
        return False


def export_session_markdown(session_id: Optional[str] = None) -> str:
    """把某会话历史导出成 Markdown（用户/助手消息，含助手 reasoning、工具、图表规格）。"""
    data = get_history(session_id)
    msgs = data.get("messages") or []
    out: list[str] = []
    for i, m in enumerate(msgs, start=1):
        if not isinstance(m, dict):
            continue
        role = m.get("role")
        content = str(m.get("content") or "")
        reasoning = str(m.get("reasoning") or "")
        if role == "user":
            out.append(f"## 用户 {i}\n\n{content}\n")
        else:
            if reasoning:
                out.append(f"### 思考 {i}\n\n{reasoning}\n")
            tools = m.get("tools") or []
            for t in tools:
                if isinstance(t, dict):
                    out.append(
                        f"### 工具 {t.get('name') or ''}\n\n"
                        f"```\n{t.get('args')}\n```\n\n"
                        f"结果：\n\n```\n{t.get('result')}\n```\n"
                    )
            out.append(f"### 回答 {i}\n\n{content}\n")
    return "\n".join(out) or "（空会话）"
