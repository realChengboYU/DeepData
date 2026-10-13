# -*- coding: utf-8 -*-
"""混合字段检索器：BM25 关键词召回 + 向量召回，RRF 融合，叠加业务加分。

- ``build(vector_store)``：建 BM25 索引，并把字段向量写入 ``vector_store``。
- ``retrieve(query, top_k)``：两路各自取 ``top_k*3`` 候选用 RRF 融合。
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from app.Schema_Indexing.objects import FieldDocument, SchemaGraph, SchemaHit

from .bm25 import BM25Index
from .graph import SchemaGraphBuilder
from .tokenizer import tokenize


class HybridSchemaRetriever:
    """字段级混合检索器（BM25 + 向量 + RRF）。"""

    RRF_K = 60

    def __init__(
        self,
        documents: List[FieldDocument],
        tables: Optional[Dict] = None,
        relations: Optional[List] = None,
    ) -> None:
        self.documents = documents
        self.tables = tables or {}
        self.relations = relations or []
        self.keyword_index = BM25Index([doc.keyword_text for doc in documents])
        self._doc_index: Dict[str, int] = {
            doc.doc_id: i for i, doc in enumerate(documents)
        }
        self.vector_store = None

    def attach_vector_store(self, vector_store=None) -> None:
        """绑定向量存储（仅供检索；向量/文本的落库由调用方负责）。"""
        self.vector_store = vector_store

    def retrieve(self, query: str, top_k: int = 10) -> List[SchemaHit]:
        """返回按融合得分降序的 top_k 个字段。"""
        if not self.documents:
            return []

        recall_size = max(top_k * 3, 20)

        # 1) BM25 路 → {doc_id: rank}
        kw_ranks: Dict[str, int] = {}
        for rank, (doc_idx, _score) in enumerate(
            self.keyword_index.search(query, top_k=recall_size), start=1
        ):
            kw_ranks[self.documents[doc_idx].doc_id] = rank

        # 2) 向量路 → {doc_id: rank}
        vec_ranks: Dict[str, int] = {}
        if self.vector_store is not None:
            for rank, (doc_id, _sim) in enumerate(
                self.vector_store.search(query, top_k=recall_size), start=1
            ):
                vec_ranks[doc_id] = rank

        # 3) RRF 融合
        fused: Dict[str, float] = {}
        for doc_id, rank in kw_ranks.items():
            fused[doc_id] = fused.get(doc_id, 0.0) + 1.0 / (self.RRF_K + rank)
        for doc_id, rank in vec_ranks.items():
            fused[doc_id] = fused.get(doc_id, 0.0) + 1.0 / (self.RRF_K + rank)

        # 4) 转 SchemaHit + 业务加分
        hits: List[SchemaHit] = []
        for doc_id, rrf_score in fused.items():
            idx = self._doc_index.get(doc_id)
            if idx is None:
                continue
            doc = self.documents[idx]
            hits.append(
                SchemaHit(
                    doc_id=doc_id,
                    score=float(rrf_score) + self._business_boost(query, doc),
                    column=doc.column,
                    keyword_rank=kw_ranks.get(doc_id) or 0,
                    vector_rank=vec_ranks.get(doc_id) or 0,
                    rrf_score=float(rrf_score),
                )
            )

        hits.sort(key=lambda hit: hit.score, reverse=True)
        return hits[:top_k]

    def build_graph(self, hits: List[SchemaHit]) -> SchemaGraph:
        """把命中字段聚合成 SchemaGraph（含表关联外扩）。"""
        return SchemaGraphBuilder(self.tables, self.relations).build(hits)

    def schema_context(self, query: str, top_k: int = 10):
        """检索并向 agent 输出 Schema 上下文，返回 (hits, prompt_text)。"""
        hits = self.retrieve(query, top_k=top_k)
        graph = self.build_graph(hits)
        return hits, graph.to_prompt_context()

    def _business_boost(self, query: str, doc: FieldDocument) -> float:
        query_lower = query.lower()
        query_tokens = set(tokenize(query))
        column = doc.column

        boost = 0.0
        if column.column_name.lower() in query_lower:
            boost += 3.0
        if column.table_name.lower() in query_lower:
            boost += 1.0
        for alias in column.aliases:
            if alias and alias.lower() in query_lower:
                boost += 4.0
        for alias in column.table_aliases:
            if alias and alias.lower() in query_lower:
                boost += 1.5

        boost += 0.2 * len(query_tokens & set(tokenize(column.description)))
        boost += 0.1 * len(query_tokens & set(tokenize(column.table_description)))
        return boost
