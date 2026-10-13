# -*- coding: utf-8 -*-
"""PGVector 向量存储（``langchain_postgres.PGVector``）。

把字段的三种文本一并落库，做到"单库同时搞定 schema 文本 + 向量"：
- ``document``  = ``vector_text``（被嵌入的那段，PGVector 的正文槽位）
- ``cmetadata`` = ``{doc_id, keyword_text, rerank_text, column}``（JSONB 元数据）
- ``langchain_pg_collection.cmetadata`` = 构建元信息（表/关系/字段数/时间戳）

由此：
- 向量路走 PGVector 相似检索；
- BM25 路走 ``load_documents()`` 全量读回 ``cmetadata`` 重建（几千字段毫秒级）。

依赖：``langchain-postgres``、``pgvector``，且目标库已 ``CREATE EXTENSION vector``。
"""
from __future__ import annotations

import dataclasses
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from langchain_core.embeddings import Embeddings
from langchain_postgres import PGVector
from langchain_postgres.vectorstores import DistanceStrategy
from sqlalchemy import create_engine, text

from app.Schema_Indexing.objects import ColumnSchema, FieldDocument

from .embedding_client import EmbeddingClient

_SAQLCHEMY_URL_PREFIX = "postgresql+psycopg://"


def to_sqlalchemy_url(database_url: str) -> str:
    """把 psycopg3 的 ``postgresql://`` 转成 SQLAlchemy 用的 ``postgresql+psycopg://``。"""
    url = (database_url or "").strip()
    if url.startswith("postgresql://"):
        return _SAQLCHEMY_URL_PREFIX + url[len("postgresql://") :]
    return url


class _LangchainEmbeddings(Embeddings):
    """把 ``EmbeddingClient`` 适配成 langchain ``Embeddings`` 接口。"""

    def __init__(self, client: EmbeddingClient):
        self._client = client

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        return self._client.embed_texts(texts).tolist()

    def embed_query(self, text: str) -> List[float]:
        return self._client.embed_texts([text])[0].tolist()


def _asdict(obj: Any) -> Any:
    """递归把 dataclass / dict / list 转成可 JSON 序列化的结构。"""
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return {k: _asdict(v) for k, v in vars(obj).items()}
    if isinstance(obj, dict):
        return {k: _asdict(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_asdict(v) for v in obj]
    return obj


@dataclass
class PGVectorStore:
    """基于 ``PGVector`` 的字段向量存取（含文本元数据）。"""

    connection: str
    collection_name: str
    embedding_client: EmbeddingClient
    embedding_length: int
    distance_strategy: DistanceStrategy = DistanceStrategy.COSINE
    pre_delete_collection: bool = False
    _store: Optional[PGVector] = None
    _engine: Optional[Any] = None

    def __post_init__(self) -> None:
        self._engine = create_engine(self.connection)
        self._store = self._new_store()

    def _new_store(self) -> PGVector:
        return PGVector(
            embeddings=_LangchainEmbeddings(self.embedding_client),
            connection=self.connection,
            collection_name=self.collection_name,
            embedding_length=self.embedding_length,
            distance_strategy=self.distance_strategy,
            pre_delete_collection=self.pre_delete_collection,
        )

    # ---------------- 写入 ----------------
    def upsert(self, documents) -> None:
        """写入字段向量 + 三种文本。``document``=vector_text，其余进 ``cmetadata``。"""
        if not documents:
            return
        texts = [doc.vector_text for doc in documents]
        metadatas = [
            {
                "doc_id": doc.doc_id,
                "keyword_text": doc.keyword_text,
                "rerank_text": doc.rerank_text,
                "column": _asdict(doc.column),
            }
            for doc in documents
        ]
        self._store.add_texts(texts=texts, metadatas=metadatas)

    # ---------------- 检索 ----------------
    def search(self, query_text: str, top_k: int = 10) -> List[Tuple[str, float]]:
        """余弦相似检索，返回 [(doc_id, 相似度)]，按相似度降序。"""
        if not query_text:
            return []
        results = self._store.similarity_search_with_score(query_text, k=top_k)
        hits: List[Tuple[str, float]] = []
        for doc, distance in results:
            doc_id = (doc.metadata or {}).get("doc_id")
            if not doc_id:
                continue
            hits.append((doc_id, 1.0 - float(distance)))
        return hits

    # ---------------- 全量读回重建 BM25 ----------------
    def load_documents(self) -> List[FieldDocument]:
        """读回该 collection 全部字段文档，重建 ``FieldDocument``（供 BM25 重建）。"""
        with self._engine.connect() as conn:
            rows = conn.execute(
                text(
                    """
                    SELECT e.document, e.cmetadata
                    FROM langchain_pg_embedding e
                    JOIN langchain_pg_collection c
                      ON e.collection_id = c.uuid
                    WHERE c.name = :name
                    ORDER BY e.id
                    """
                ),
                {"name": self.collection_name},
            ).fetchall()

        docs: List[FieldDocument] = []
        for document, cmetadata in rows:
            cmetadata = cmetadata or {}
            col_dict = cmetadata.get("column") or {}
            column = ColumnSchema(
                **{
                    k: v
                    for k, v in col_dict.items()
                    if k in ColumnSchema.__dataclass_fields__
                }
            )
            docs.append(
                FieldDocument(
                    doc_id=cmetadata.get("doc_id"),
                    column=column,
                    keyword_text=cmetadata.get("keyword_text", ""),
                    vector_text=document or "",
                    rerank_text=cmetadata.get("rerank_text", ""),
                )
            )
        return docs

    def count(self) -> int:
        with self._engine.connect() as conn:
            row = conn.execute(
                text(
                    """
                    SELECT COUNT(*) FROM langchain_pg_embedding e
                    JOIN langchain_pg_collection c ON e.collection_id = c.uuid
                    WHERE c.name = :name
                    """
                ),
                {"name": self.collection_name},
            ).fetchone()
        return int(row[0]) if row else 0

    # ---------------- 构建元信息 ----------------
    def get_meta(self) -> Dict[str, Any]:
        with self._engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT cmetadata FROM langchain_pg_collection WHERE name = :name"
                ),
                {"name": self.collection_name},
            ).fetchone()
        if not row or row[0] is None:
            return {}
        return row[0] if isinstance(row[0], dict) else json.loads(row[0])

    def set_meta(
        self,
        source_id: str,
        field_count: int,
        tables: Optional[List] = None,
        relations: Optional[List] = None,
        version: str = "1",
    ) -> None:
        """写入/更新该 collection 的构建元信息（表/关系/字段数/时间戳）。"""
        meta = {
            "source_id": source_id,
            "field_count": field_count,
            "indexed_at": datetime.now(timezone.utc).isoformat(),
            "tables": _asdict(tables) if tables else [],
            "relations": _asdict(relations) if relations else [],
            "version": version,
        }
        with self._engine.connect() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO langchain_pg_collection (uuid, name, cmetadata)
                    VALUES (gen_random_uuid(), :name, CAST(:meta AS json))
                    ON CONFLICT (name) DO UPDATE SET cmetadata = CAST(:meta AS json)
                    """
                ),
                {"name": self.collection_name, "meta": json.dumps(meta, ensure_ascii=False)},
            )
            conn.commit()

    def reset(self) -> None:
        """只删除当前 collection（不误删同库其它数据源的 collection）。

        删除后会重建一个空的 ``_store``，下次 ``upsert`` 从零写。
        """
        try:
            self._store.delete_collection()
        except Exception:  # collection 不存在等，忽略
            pass
        self._store = self._new_store()

    def dispose(self) -> None:
        """释放底层 SQLAlchemy 连接池（进程退出时调用）。"""
        if self._engine is not None:
            self._engine.dispose()
