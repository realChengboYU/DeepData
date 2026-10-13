"""提示词构造：把系统提示 + 会话历史 + 当前问题拼成发给 LLM 的消息列表。

统一在这里完成消息构造，避免在各个调用点手写 role/content 拼装，
也便于后续统一调整 system 提示、历史过滤规则等。
"""

from typing import Optional, Sequence

from app.prompt.system import SYSTEM_PROMPT


def compose_system_prompt(
    skill_instructions: Optional[str] = None,
    schema_context: Optional[str] = None,
) -> str:
    """构造发送给 LLM 的 system 文本。

    约定：通用角色/准则放在 SYSTEM_PROMPT，能力级指令由 Skill 的 SKILL.md 提供，
    这里在运行时拼接。**不要把 NL2SQL 等能力细节写死进 SYSTEM_PROMPT**，
    它们应以 SKILL.md 的形式存在于 app/skills/<skill>/SKILL.md。

    Args:
        skill_instructions: 某个 Skill 的 SKILL.md 指令文本（可为 None，则只用通用 SYSTEM_PROMPT）。
        schema_context: 当前问题相关字段的 Schema 上下文（来自 Schema 检索），拼接在末尾。
    """
    parts = [SYSTEM_PROMPT]
    if skill_instructions:
        parts.append(skill_instructions)
    if schema_context:
        parts.append(
            "## 相关数据表 Schema（已按你的问题召回的候选表与字段，优先使用；不足时再用工具补充）\n\n"
            + schema_context
        )
    if len(parts) == 1:
        return SYSTEM_PROMPT
    return "\n\n---\n\n".join(parts)


def build_messages(
    history: Optional[Sequence] = None,
    question: Optional[str] = None,
    system_prompt: str = SYSTEM_PROMPT,
    skill_instructions: Optional[str] = None,
    schema_context: Optional[str] = None,
) -> list[dict]:
    """构造发给 LLM 的完整消息列表：`[system, ...history(仅 role/content), <user 当前问题>]`。

    规则：
    - 历史只保留 role/content，丢弃 reasoning / tools 等仅前端展示的字段。
    - 历史中若出现 role=system 会跳过（系统提示只在头部出现一次）。
    - question 非空时，作为一条 user 消息追加到末尾。

    Args:
        history: 会话历史（可能是 list[dict]，也可能是旧格式对象）。
        question: 当前用户问题；为 None 时不追加（历史里可能已包含当前问题）。
        system_prompt: 覆盖默认系统提示词。
        skill_instructions: 可选，某 Skill 的 SKILL.md 指令文本；提供时拼接到 system 末尾（由 SKILL.md 提供内容，非写死）。
        schema_context: 可选，当前问题相关字段的 Schema 上下文；提供时拼接到 system 末尾。
    """
    if skill_instructions or schema_context:
        system_content = compose_system_prompt(skill_instructions, schema_context)
    else:
        system_content = system_prompt
    messages: list[dict] = [{"role": "system", "content": system_content}]
    for m in history or []:
        role = m.get("role", "user") if isinstance(m, dict) else "user"
        if role == "system":
            continue
        content = (m.get("content") or "") if isinstance(m, dict) else str(m)
        messages.append({"role": role, "content": content})

    if question is not None:
        q = (question or "").strip()
        if q:
            messages.append({"role": "user", "content": q})

    return messages


def strip_history(history: Optional[Sequence] = None) -> list[dict]:
    """只保留 role/content 的历史消息，不追加系统提示（供不需要 system 的场景）。"""
    out: list[dict] = []
    for m in history or []:
        role = m.get("role", "user") if isinstance(m, dict) else "user"
        content = (m.get("content") or "") if isinstance(m, dict) else str(m)
        out.append({"role": role, "content": content})
    return out
