# -*- coding: utf-8 -*-
"""SchemaGraph 构建 与 SchemaIndexManager 单测。"""
import unittest

from app.Schema_Retrival import (
    HybridSchemaRetriever,
    SchemaGraphBuilder,
    SchemaIndexManager,
)
from app.Schema_Indexing import SchemaIndexTextBuilder
from app.Schema_Indexing.objects import ColumnSchema, TableRelation, TableSchema


def _cols():
    cols = [
        ColumnSchema(
            database="bst", table_name="FUEL_CB_COALBALANCE", column_name="BALANCEQTY",
            data_type="numeric(18,2)", table_description="燃煤采购结算主表",
            description="结算数量(吨)", aliases=["结算数量"], semantic_role="metric",
        ),
        ColumnSchema(
            database="bst", table_name="FUEL_CB_COALBALANCE", column_name="BALANCEMONEY",
            data_type="numeric(18,2)", table_description="燃煤采购结算主表",
            description="结算总金额(元)", semantic_role="metric",
        ),
        ColumnSchema(
            database="bst", table_name="FUEL_CB_COALCONTRACT", column_name="CONTRACTID",
            data_type="text", table_description="采购合同表", description="合同ID",
            semantic_role="join_key",
        ),
    ]
    return SchemaIndexTextBuilder().build_many(cols)


def _relations():
    return [
        TableRelation(
            database="bst", source_table="FUEL_CB_COALBALANCE", source_column="CONTRACTID",
            target_table="FUEL_CB_COALCONTRACT", target_column="CONTRACTID",
            relation_type="foreign_key", description="结算记录引用合同",
        )
    ]


class TestSchemaGraphBuilder(unittest.TestCase):
    def test_build_groups_and_expands_relations(self):
        docs = _cols()
        tables = {
            "FUEL_CB_COALBALANCE": TableSchema("bst", "FUEL_CB_COALBALANCE", "燃煤采购结算主表"),
            "FUEL_CB_COALCONTRACT": TableSchema("bst", "FUEL_CB_COALCONTRACT", "采购合同表"),
        }
        retriever = HybridSchemaRetriever(documents=docs, tables=tables, relations=_relations())
        hits = retriever.retrieve("结算数量", top_k=3)
        graph = retriever.build_graph(hits)
        self.assertEqual(graph.database, "bst")
        # 命中表 + 一跳外扩（合同表也进来）
        self.assertIn("FUEL_CB_COALBALANCE", graph.tables)
        self.assertIn("FUEL_CB_COALCONTRACT", graph.tables)
        # 关联关系被包含
        self.assertTrue(graph.relations)
        prompt = graph.to_prompt_context()
        self.assertIn("数据库：bst", prompt)
        self.assertIn("表名：FUEL_CB_COALBALANCE", prompt)
        self.assertIn("字段名：BALANCEQTY", prompt)
        self.assertIn("↔", prompt)


class _FakeService:
    """假 service：记录 rebuild 调用，返回可控 retriever。"""

    def __init__(self, retriever):
        self.retriever = retriever
        self.rebuild_count = 0

    def rebuild(self, source_id, user_key):
        self.rebuild_count += 1
        return self.retriever

    def load_index(self, source_id):
        return None

    def _get_store(self, source_id):
        class _Store:
            def get_meta(self):
                return {"indexed_at": "2026-01-01T00:00:00+00:00"}
        return _Store()


class TestSchemaIndexManager(unittest.TestCase):
    def test_ready_via_db_loads_retriever(self):
        docs = _cols()
        retriever = HybridSchemaRetriever(documents=docs)
        svc = _FakeService(retriever)

        class _ReadyService(_FakeService):
            def load_index(self, source_id):
                return retriever

        mgr = SchemaIndexManager(_ReadyService(retriever), max_workers=1)
        r, status = mgr.ensure_index("src1", "user")
        self.assertEqual(r, retriever)
        self.assertEqual(status["status"], "ready")
        mgr.shutdown()

    def test_building_triggers_background_but_returns_none(self):
        docs = _cols()
        retriever = HybridSchemaRetriever(documents=docs)
        svc = _FakeService(retriever)  # load_index -> None, so must build
        mgr = SchemaIndexManager(svc, max_workers=1)
        r, status = mgr.ensure_index("src1", "user")
        self.assertIsNone(r)
        self.assertEqual(status["status"], "building")
        # 等后台完成
        import time
        for _ in range(50):
            if svc.rebuild_count > 0 and mgr.get_status("src1")["status"] == "ready":
                break
            time.sleep(0.05)
        self.assertEqual(svc.rebuild_count, 1)
        self.assertEqual(mgr.get_status("src1")["status"], "ready")
        mgr.shutdown()

    def test_concurrent_trigger_does_not_double_build(self):
        docs = _cols()
        retriever = HybridSchemaRetriever(documents=docs)
        svc = _FakeService(retriever)
        mgr = SchemaIndexManager(svc, max_workers=1)
        # 第一次触发
        mgr.ensure_index("src1", "user")
        # 立刻再次 ensure（同一 source，尚在 building）不应触发第二次
        mgr.ensure_index("src1", "user")
        import time
        for _ in range(50):
            if mgr.get_status("src1")["status"] == "ready":
                break
            time.sleep(0.05)
        # 并发触发同一 source，只会真正构建一次
        self.assertEqual(svc.rebuild_count, 1)
        mgr.shutdown()


if __name__ == "__main__":
    unittest.main()
