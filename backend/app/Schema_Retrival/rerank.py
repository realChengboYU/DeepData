# -*- coding: utf-8 -*-
"""字段精排：用当前会话模型（temp=0）对混合召回命中的字段做二次相关筛选。

把「用户问题 + 10 个候选字段信息」喂给模型，只让它返回真正相关的字段
``doc_id`` 列表，再据此过滤 hits。经筛选后剩余的字段文本仍会拼接成
Schema 上下文注入主模型 system 提示（不改变原有注入链路，只是缩小字段集）。

任何失败（网络/超时/解析不出/返回空集）一律回退「原 hits」，保证精排不会把
召回链路搞挂。
"""
from __future__ import annotations

import json
import re
from typing import List

from app.Schema_Indexing.objects import SchemaHit


def _field_block(idx: int, hit: SchemaHit) -> str:
    """把单个命中字段压缩成一条候选信息（只带判断相关性所需的最小集）。"""
    col = hit.column
    aliases = "、".join(col.aliases) if col.aliases else "-"
    samples = "、".join(str(s) for s in col.samples[:3]) if col.samples else "-"
    return (
        f"{idx}. {hit.doc_id}\n"
        f"   表：{col.table_name} | 字段：{col.column_name} | 类型：{col.data_type} | 角色：{col.semantic_role or '-'}\n"
        f"   含义：{col.description or '-'}\n"
        f"   别名：{aliases}\n"
        f"   所属表：{col.table_description or '-'}\n"
        f"   样例：{samples}"
    )


def _rerank_system_prompt() -> str:
    return (
        "你是数据库字段筛选助手。根据「用户问题」，从候选字段列表中，只选出【回答该问题真正需要】的字段。\n\n"
        "判断依据：\n"
        "- 只选能直接支撑问题所问的 指标(metric)、筛选条件(dimension/filter)、时间(time)、关联键(join_key) 的字段。\n"
        "- 优先字段名、字段别名、字段含义与问题词面或语义匹配的字段。\n"
        "- 若问题需要多表连接，则把关联键以及两边所需的字段都选上。\n"
        "- 不要选「只是出现在相关表里、但与问题无关」的字段。\n"
        "- 不要凭空添加候选列表之外的字段。\n\n"
        "输出要求：\n"
        "- 只输出一个 JSON 数组，元素为选中字段的 “doc_id”（候选里的「数据库.表.字段」标识）。\n"
        "- 一个都不需要时输出 []。\n"
        "- 不要输出任何解释、Markdown 或其它文字，只输出 JSON。"
    )


def _build_messages(query: str, hits: List[SchemaHit]) -> List[dict]:
    lines = [f"候选字段（共 {len(hits)} 个）：", ""]
    for i, hit in enumerate(hits, start=1):
        lines.append(_field_block(i, hit))
        lines.append("")
    return [
        {"role": "system", "content": _rerank_system_prompt()},
        {"role": "user", "content": f"用户问题：{query}\n\n" + "\n".join(lines)},
    ]


def _parse_doc_ids(text: str) -> List[str]:
    """从模型返回里提取 JSON 数组（doc_id 列表）。宽松：先取第一个 [...]。"""
    if not text:
        return []
    m = re.search(r"\[.*?\]", text, re.DOTALL)
    if not m:
        return []
    try:
        data = json.loads(m.group(0))
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    return [str(x).strip() for x in data if str(x).strip() and str(x).strip() != "None"]


def _match_doc_id(raw: List[str], hits: List[SchemaHit]) -> set:
    """把模型返回的标识匹配到 hits 的 doc_id（宽松：doc_id / 表.字段 / 纯字段名）。"""
    by_doc = {h.doc_id: h for h in hits}
    chosen: set = set()
    for token in raw:
        if token in by_doc:
            chosen.add(token)
            continue
        for h in hits:
            col = h.column
            if token in (f"{col.table_name}.{col.column_name}", col.column_name):
                chosen.add(h.doc_id)
    return chosen


def rerank_schema_hits(query: str, hits: List[SchemaHit], llm) -> List[SchemaHit]:
    """用会话模型（temp=0）精筛字段。任何失败/空集回退原 hits。"""
    if not hits or llm is None:
        return hits
    try:
        messages = _build_messages(query, hits)
        msg = llm.invoke(messages)
        content = getattr(msg, "content", None) or ""
        if isinstance(content, list):  # 个别模型返回 content_blocks 列表
            content = "".join(
                b.get("text", "") if isinstance(b, dict) else str(b) for b in content
            )
        chosen = _match_doc_id(_parse_doc_ids(content), hits)
        if not chosen:
            return hits  # 空集 / 解析不出 → 回退原 hits，保住召回
        # 保持原始分数顺序（不去重乱序）
        return [h for h in hits if h.doc_id in chosen]
    except Exception:
        return hits
