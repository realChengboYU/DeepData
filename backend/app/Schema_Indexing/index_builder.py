from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, List, Optional

from .objects import ColumnSchema, FieldDocument, TableRelation
from .text_builder import SchemaIndexTextBuilder


@dataclass
class SchemaIndexBuildResult:
    """索引构造结果。"""

    field_document_count: int
    relation_count: int = 0
    field_collection_name: Optional[str] = None
    relation_collection_name: Optional[str] = None


class SchemaIndexBuilder:
    """
    Schema 索引构造主流程。

    这里负责「构造」：把字段元数据 ColumnSchema 转成带三级索引文本的 FieldDocument。
    写库（Milvus / 其它向量库）与 Embedding 属于存储/检索层，通过 ``build`` 的
    ``embedding_client``、``store_client`` 注入；未注入时仅做纯构造（build_documents_only）。
    """

    def __init__(self, text_builder: SchemaIndexTextBuilder):
        self.text_builder = text_builder

    def build_documents_only(self, columns: List[ColumnSchema]) -> List[FieldDocument]:
        """只构造字段文档，不写入任何存储 / 不做 Embedding。"""
        return self.text_builder.build_many(columns)

    def build(
        self,
        columns: List[ColumnSchema],
        relations: Optional[List[TableRelation]] = None,
        embedding_client: Optional[Any] = None,
        store_client: Optional[Any] = None,
    ) -> SchemaIndexBuildResult:
        """
        执行索引构造。

        仅构造 field 文档；若同时注入 ``embedding_client`` 与 ``store_client``，
        则进一步做 Embedding 并写入字段 / 关系索引（供检索层使用）。
        """
        if not columns:
            raise ValueError("columns 为空，无法构造字段索引。")

        documents = self.text_builder.build_many(columns)
        relations = relations or []

        if embedding_client is None or store_client is None:
            # 纯构造，不写库。
            return SchemaIndexBuildResult(
                field_document_count=len(documents),
                relation_count=len(relations),
            )

        vector_texts = [doc.vector_text for doc in documents]
        embeddings = embedding_client.embed_texts(vector_texts)

        store_client.prepare_collections()

        store_client.insert_field_documents(
            documents=documents,
            embeddings=[
                embedding.astype(float).tolist() if hasattr(embedding, "astype") else list(embedding)
                for embedding in embeddings
            ],
        )

        if relations:
            store_client.insert_relations(relations)

        return SchemaIndexBuildResult(
            field_collection_name=getattr(
                getattr(store_client, "config", None), "field_collection_name", None
            ),
            relation_collection_name=getattr(
                getattr(store_client, "config", None), "relation_collection_name", None
            ),
            field_document_count=len(documents),
            relation_count=len(relations),
        )
