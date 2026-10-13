"""Schema 索引服务助手：进程级单例 + 便捷取上下文。

被两处复用：
- router（schema_index.py）：构建/重建/状态/检索接口。
- 对话管线（runner.py）：拿到当前数据源后，把 Schema 上下文注入 system 提示。

构建走后台线程（SchemaIndexManager），不会阻塞 Web worker。
"""
from __future__ import annotations

from typing import Optional, Tuple

from app.Schema_Retrival import (
    EmbeddingClient,
    SchemaIndexManager,
    SchemaIndexService,
    rerank_schema_hits,
)

_manager: Optional[SchemaIndexManager] = None


def get_schema_index_manager() -> SchemaIndexManager:
    """进程级单例（线程安全：内部按 source_id 加锁 + 后台线程池）。"""
    global _manager
    if _manager is None:
        _manager = SchemaIndexManager(
            service=SchemaIndexService(embedding_client=EmbeddingClient())
        )
    return _manager


def get_schema_context(
    source_id: str,
    user_key: str,
    query: str,
    top_k: int = 10,
    rerank_llm: Optional[object] = None,
) -> Tuple[Optional[list], str]:
    """取该数据源在 ``query`` 下的 Schema 上下文。

    ``rerank_llm`` 提供时，会对 top_k 命中字段做一次模型精筛（用当前会话模型 temp=0），
    再把筛选后的字段拼进 Schema 上下文。。
    """
    try:
        manager = get_schema_index_manager()
        retriever, _status = manager.ensure_index(source_id, user_key)
        if retriever is None:
            return None, ""
        hits, prompt = retriever.schema_context(query, top_k=top_k)
        if rerank_llm is not None:
            hits = rerank_schema_hits(query, hits, rerank_llm)
            prompt = retriever.build_graph(hits).to_prompt_context()
        return hits, prompt
    except Exception:
        return None, ""
