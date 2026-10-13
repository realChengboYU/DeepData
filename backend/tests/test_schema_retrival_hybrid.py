# -*- coding: utf-8 -*-
"""Schema_Retrival 混合检索 与 PGVectorStore 工具单测。"""
import unittest

from app.Schema_Retrival import HybridSchemaRetriever, to_sqlalchemy_url
from app.Schema_Indexing import SchemaIndexTextBuilder
from app.Schema_Indexing.objects import ColumnSchema


def _docs():
    cols = [
        ColumnSchema(
            database="bst", table_name="FUEL_CB_COALBALANCE", column_name="BALANCEQTY",
            data_type="numeric(18,2)", table_description="燃煤采购结算主表",
            description="结算数量(吨)", aliases=["结算数量"], samples=["100"], semantic_role="metric",
        ),
        ColumnSchema(
            database="bst", table_name="FUEL_CB_COALBALANCE", column_name="BALANCEMONEY",
            data_type="numeric(18,2)", table_description="燃煤采购结算主表",
            description="结算总金额(元)", aliases=["结算金额"], samples=["999"], semantic_role="metric",
        ),
        ColumnSchema(
            database="bst", table_name="FUEL_CMCS_ASSAY", column_name="ASSAYWAY",
            data_type="text", table_description="化验表", description="化验方式",
            samples=["实验室"], semantic_role="dimension",
        ),
    ]
    return SchemaIndexTextBuilder().build_many(cols)


class _FakeVectorStore:
    """模拟向量路：对含指定文本的字段返回高分。"""

    def __init__(self, doc_ids_on_top):
        self.doc_ids_on_top = doc_ids_on_top
        self.upserted = None

    def upsert(self, documents):
        self.upserted = documents

    def search(self, query_text, top_k=10):
        hits = []
        # 让 "化验" 命中第三篇
        if "化验" in query_text:
            hits = [("bst.FUEL_CMCS_ASSAY.ASSAYWAY", 0.9)]
        return hits[:top_k]


class TestToSqlalchemyUrl(unittest.TestCase):
    def test_convert(self):
        url = to_sqlalchemy_url("postgresql://askdata:askdata@localhost:5432/askdata_memory")
        self.assertEqual(url, "postgresql+psycopg://askdata:askdata@localhost:5432/askdata_memory")

    def test_keep_existing(self):
        url = to_sqlalchemy_url("postgresql+psycopg://u@h/db")
        self.assertEqual(url, "postgresql+psycopg://u@h/db")

    def test_empty(self):
        self.assertEqual(to_sqlalchemy_url(""), "")


class TestHybridRetriever(unittest.TestCase):
    def test_attach_vector_store(self):
        docs = _docs()
        vs = _FakeVectorStore([])
        retriever = HybridSchemaRetriever(documents=docs)
        retriever.attach_vector_store(vs)
        self.assertEqual(retriever.vector_store, vs)

    def test_rrf_fuses_bm25_and_vector(self):
        docs = _docs()
        vs = _FakeVectorStore([])
        retriever = HybridSchemaRetriever(documents=docs)
        retriever.attach_vector_store(vs)

        # 向量路把 ASSAYWAY 顶到最前，即使 BM25 略低，RRF 应保它进 top
        hits = retriever.retrieve("化验方式", top_k=3)
        top_ids = [h.doc_id for h in hits]
        self.assertIn("bst.FUEL_CMCS_ASSAY.ASSAYWAY", top_ids)
        # 混合命中优先级：向量路命中的应在第 1
        self.assertEqual(hits[0].doc_id, "bst.FUEL_CMCS_ASSAY.ASSAYWAY")

    def test_keyword_weight_on_match(self):
        docs = _docs()
        retriever = HybridSchemaRetriever(documents=docs)
        retriever.attach_vector_store(None)
        hits = retriever.retrieve("结算数量", top_k=3)
        self.assertEqual(hits[0].column.column_name, "BALANCEQTY")

    def test_no_vector_store_still_works(self):
        docs = _docs()
        retriever = HybridSchemaRetriever(documents=docs)
        retriever.attach_vector_store(None)
        hits = retriever.retrieve("结算总金额", top_k=3)
        self.assertTrue(hits)
        self.assertEqual(hits[0].column.column_name, "BALANCEMONEY")


if __name__ == "__main__":
    unittest.main()
