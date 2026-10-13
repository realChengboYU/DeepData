# -*- coding: utf-8 -*-
"""字段级 Schema 检索器：BM25 关键词召回 + 业务规则加分。

输入为 ``Schema_Indexing`` 构造出的 ``FieldDocument``（含 keyword_text）。
先 ``build()`` 建索引，再 ``retrieve(query)`` 返回命中字段，按得分降序。

后续扩展：
- 叠加向量召回做 RRF。
- 加 Rerank 精排。
- LLM 查询词扩展。
"""
from __future__ import annotations

from typing import Dict, List, Optional

from app.Schema_Indexing.objects import FieldDocument, SchemaHit

from .bm25 import BM25Index
from .tokenizer import tokenize


class SchemaRetriever:
    """字段级 Schema 检索器（当前为 BM25 + 业务加分）。"""

    def __init__(
        self,
        documents: List[FieldDocument],
        tables: Optional[Dict] = None,
        relations: Optional[List] = None,
    ) -> None:
        self.documents = documents
        self.tables = tables or {}
        self.relations = relations or []
        self.keyword_index: Optional[BM25Index] = None

    def build(self) -> None:
        """基于 keyword_text 构建 BM25 索引。"""
        self.keyword_index = BM25Index([doc.keyword_text for doc in self.documents])

    def retrieve(self, query: str, top_k: int = 10) -> List[SchemaHit]:
        """召回 top_k 个字段，按得分降序。

        先以 ``max(top_k * 3, 20)`` 取初选（给加分/融合留余量），
        再叠加业务加分后截断到 ``top_k``。
        """
        if self.keyword_index is None:
            raise RuntimeError("SchemaRetriever 尚未 build，请先调用 build()。")

        raw_hits = self.keyword_index.search(query, top_k=max(top_k * 3, 20))

        hits: List[SchemaHit] = []
        for doc_idx, bm25_score in raw_hits:
            doc = self.documents[doc_idx]
            boost = self._business_boost(query, doc)
            hits.append(
                SchemaHit(
                    doc_id=doc.doc_id,
                    score=float(bm25_score) + boost,
                    column=doc.column,
                    keyword_rank=len(hits) + 1,
                )
            )

        hits.sort(key=lambda hit: hit.score, reverse=True)
        return hits[:top_k]

    def _business_boost(self, query: str, doc: FieldDocument) -> float:
        """简单业务规则加分（后续可用 Rerank 替代）。

        - Query 直接包含字段名 / 表名 / 别名 / 表别名 → 加分。
        - Query 词元与字段描述、表描述词元重合 → 加分（带衰减系数）。
        """
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

        description_tokens = set(tokenize(column.description))
        table_description_tokens = set(tokenize(column.table_description))
        boost += 0.2 * len(query_tokens & description_tokens)
        boost += 0.1 * len(query_tokens & table_description_tokens)

        return boost
