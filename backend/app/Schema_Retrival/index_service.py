# -*- coding: utf-8 -*-
"""Schema 索引编排服务：装载 → 构造 → 嵌入并全量落库到 PGVector → 混合检索。

用 ``ensure_index(source_id, user_key)`` 拿检索器：
- 已在库（``collection`` 有数据）→ 直接从 PGVector 读回重建 BM25（不重装/不重算）。
- 未在库 → 从源库装载 + 构造 + 嵌入 + 落库，再返回。

``rebuild(source_id, user_key)`` 强制重装重算（会清掉该 source 的旧 collection）。
"""
from __future__ import annotations

from typing import Dict, Optional

from app.Schema_Indexing.loader import DeepDataSourceLoader
from app.Schema_Indexing.objects import TableRelation, TableSchema
from app.Schema_Indexing.text_builder import SchemaIndexTextBuilder
from app.services.memory.store import DATABASE_URL

from .embedding_client import EmbeddingClient
from .hybrid import HybridSchemaRetriever
from .vector_store import PGVectorStore, to_sqlalchemy_url

DEFAULT_COLLECTION_PREFIX = "schema_vec_"


class SchemaIndexService:
    """按数据源维护字段 Schema 向量索引 + 混合检索器。"""

    def __init__(
        self,
        embedding_client: EmbeddingClient,
        database_url: Optional[str] = None,
        connection: Optional[str] = None,
        sample_size: int = 5,
    ) -> None:
        self.embedding_client = embedding_client
        self.database_url = database_url or DATABASE_URL
        self.connection = connection or to_sqlalchemy_url(self.database_url)
        self.sample_size = sample_size
        self._cache: Dict[str, HybridSchemaRetriever] = {}

    # ---------------- 对外 ----------------
    def ensure_index(
        self, source_id: str, user_key: str, force_rebuild: bool = False
    ) -> HybridSchemaRetriever:
        """取该数据源检索器；有缓存直接用，否则读库/构建。"""
        if not force_rebuild and source_id in self._cache:
            return self._cache[source_id]

        store = self._get_store(source_id, pre_delete=force_rebuild)
        meta = {} if force_rebuild else store.get_meta()
        if meta and meta.get("field_count") and store.count() > 0:
            retriever = self._load_from_store(store, meta)
        else:
            retriever = self._build_and_persist(source_id, user_key, store)

        self._cache[source_id] = retriever
        return retriever

    def rebuild(self, source_id: str, user_key: str) -> HybridSchemaRetriever:
        """强制重装、重算并落库（会清空该 source 旧 collection）。"""
        self._cache.pop(source_id, None)
        return self.ensure_index(source_id, user_key, force_rebuild=True)

    def invalidate(self, source_id: str) -> None:
        self._cache.pop(source_id, None)

    def load_index(self, source_id: str) -> Optional[HybridSchemaRetriever]:
        """只读：若该 source 已在库则从 PGVector 读回重建，否则返回 None（不构建）。"""
        store = self._get_store(source_id)
        meta = store.get_meta()
        if meta and meta.get("field_count") and store.count() > 0:
            return self._load_from_store(store, meta)
        return None

    # ---------------- 内部 ----------------
    def _collection_name(self, source_id: str) -> str:
        return DEFAULT_COLLECTION_PREFIX + source_id

    def _get_store(self, source_id: str, pre_delete: bool = False) -> PGVectorStore:
        return PGVectorStore(
            connection=self.connection,
            collection_name=self._collection_name(source_id),
            embedding_client=self.embedding_client,
            embedding_length=self.embedding_client.config.dimensions,
            pre_delete_collection=pre_delete,
        )

    def _build_and_persist(
        self, source_id: str, user_key: str, store: PGVectorStore
    ) -> HybridSchemaRetriever:
        loaded = DeepDataSourceLoader(sample_size=self.sample_size).load(source_id, user_key)
        docs = SchemaIndexTextBuilder().build_many(loaded.columns)

        store.upsert(docs)
        store.set_meta(
            source_id=source_id,
            field_count=len(docs),
            tables=loaded.tables,
            relations=loaded.relations,
        )

        retriever = HybridSchemaRetriever(
            documents=docs, tables=loaded.tables, relations=loaded.relations
        )
        retriever.attach_vector_store(store)
        return retriever

    def _load_from_store(
        self, store: PGVectorStore, meta: dict
    ) -> HybridSchemaRetriever:
        docs = store.load_documents()
        tables = self._rehydrate_tables(meta.get("tables"))
        relations = self._rehydrate_relations(meta.get("relations"))
        retriever = HybridSchemaRetriever(
            documents=docs, tables=tables, relations=relations
        )
        retriever.attach_vector_store(store)
        return retriever

    @staticmethod
    def _rehydrate_tables(meta_tables) -> dict:
        """把 meta 里 JSON 化的表结构还原成 ``Dict[str, TableSchema]``。"""
        if not isinstance(meta_tables, dict):
            return meta_tables or {}
        out = {}
        for name, item in meta_tables.items():
            if isinstance(item, dict):
                out[name] = TableSchema(
                    **{f: item[f] for f in TableSchema.__dataclass_fields__ if f in item}
                )
            else:
                out[name] = item
        return out

    @staticmethod
    def _rehydrate_relations(meta_relations) -> list:
        """把 meta 里 JSON 化的关系还原成 ``List[TableRelation]``。"""
        if not isinstance(meta_relations, list):
            return meta_relations or []
        out = []
        for item in meta_relations:
            if isinstance(item, dict):
                out.append(
                    TableRelation(
                        **{f: item[f] for f in TableRelation.__dataclass_fields__ if f in item}
                    )
                )
            else:
                out.append(item)
        return out
