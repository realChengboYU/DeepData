# -*- coding: utf-8 -*-
"""Schema_Retrival BM25 与检索器单测。"""
import unittest

from app.Schema_Retrival import BM25Index, SchemaRetriever
from app.Schema_Indexing import SchemaIndexTextBuilder
from app.Schema_Indexing.objects import ColumnSchema


def _docs():
    cols = [
        ColumnSchema(
            database="bst", table_name="FUEL_CB_COALBALANCE", column_name="BALANCENUM",
            data_type="numeric(18,2)", table_description="燃煤采购结算主表",
            description="本次结算数量", aliases=["结算数量", "结算量"],
            samples=["100", "200"], semantic_role="metric",
        ),
        ColumnSchema(
            database="bst", table_name="FUEL_CB_COALBALANCE", column_name="CREATIONTIME",
            data_type="timestamp", table_description="燃煤采购结算主表",
            description="创建时间", samples=["2024-01-01"], semantic_role="time",
        ),
        ColumnSchema(
            database="bst", table_name="FUEL_CB_USER", column_name="USERNAME",
            data_type="text", table_description="用户表",
            description="用户名", samples=["张三"], semantic_role="dimension",
        ),
    ]
    return SchemaIndexTextBuilder().build_many(cols)


class TestBM25Index(unittest.TestCase):
    def test_search_ranks_matching_doc(self):
        docs = ["燃煤采购结算 结算数量 结算金额", "创建时间 用户 日期", "用户名 用户表 张三"]
        index = BM25Index(docs)
        hits = index.search("结算数量", top_k=3)
        self.assertTrue(hits)
        self.assertEqual(hits[0][0], 0)  # 命中第 0 篇

    def test_query_token_hits(self):
        index = BM25Index(["燃煤采购结算 数量"])
        hits = index.search("采购", top_k=5)
        self.assertTrue(hits)
        self.assertEqual(hits[0][0], 0)

    def test_empty_docs(self):
        index = BM25Index([])
        self.assertEqual(index.search("任意"), [])


class TestSchemaRetriever(unittest.TestCase):
    def test_retrieve_finds_field(self):
        docs = _docs()
        retriever = SchemaRetriever(documents=docs)
        retriever.build()

        hits = retriever.retrieve("本次结算数量是多少", top_k=3)
        self.assertTrue(hits)
        top = hits[0]
        self.assertTrue(top.doc_id.endswith("BALANCENUM"))
        self.assertEqual(top.column.column_name, "BALANCENUM")

    def test_retrieve_field_name_direct(self):
        docs = _docs()
        retriever = SchemaRetriever(documents=docs)
        retriever.build()

        hits = retriever.retrieve("CREATE TIME 创建时间", top_k=3)
        top_ids = [h.doc_id for h in hits]
        self.assertIn("bst.FUEL_CB_COALBALANCE.CREATIONTIME", top_ids)

    def test_requires_build(self):
        retriever = SchemaRetriever(documents=_docs())
        with self.assertRaises(RuntimeError):
            retriever.retrieve("任意", top_k=3)


if __name__ == "__main__":
    unittest.main()
