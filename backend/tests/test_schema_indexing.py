# -*- coding: utf-8 -*-
"""Schema_Indexing 装载器 + 构造过程单测（用假连接，不依赖真实库）。"""
import sys
import unittest

from app.Schema_Indexing import DeepDataSourceLoader, SchemaIndexTextBuilder
from app.Schema_Indexing.objects import ColumnSchema, TableSchema


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def all(self):
        return self._rows


class _FakeConn:
    """按 SQL 子串匹配返回预置行，模拟 conn.execute(...).mappings().all()。"""

    def __init__(self, rules):
        # rules: list[(marker, rows)]；按顺序匹配第一个命中。
        self.rules = rules

    def execute(self, sql, params=None):
        s = str(sql)
        for marker, rows in self.rules:
            if marker in s:
                return _FakeResult(rows)
        return _FakeResult([])


class TestEnum(unittest.TestCase):
    def test_parse_enum(self):
        p = DeepDataSourceLoader._parse_enum
        self.assertEqual(p("启用,禁用"), ["启用", "禁用"])
        self.assertEqual(p("['a', 'b']"), ["a", "b"])
        self.assertEqual(p("{是,否}"), ["是", "否"])
        self.assertEqual(p("启用；禁用"), ["启用", "禁用"])
        self.assertEqual(p(""), [])
        self.assertEqual(p(None), [])


class TestSemanticRole(unittest.TestCase):
    def test_infer_role(self):
        r = DeepDataSourceLoader._infer_semantic_role
        self.assertEqual(r("user_id", False, None), "join_key")
        self.assertEqual(r("CREATORUSERID", False, None), "join_key")
        self.assertEqual(r("create_time", False, None), "time")
        self.assertEqual(r("total_count", False, None), "metric")
        self.assertEqual(r("status", False, None), "dimension")
        self.assertEqual(r("order_id", False, "orders.id"), "join_key")
        self.assertEqual(r("remark", False, None), "")


class TestBuildColumn(unittest.TestCase):
    def test_merge_curated_and_raw(self):
        loader = DeepDataSourceLoader(synonyms={"balance_num": ["余额", "结余"]})
        raw = {
            "column_name": "balance_num",
            "data_type": "numeric(18,2)",
            "nullable": False,
            "comment": "账面余额",
            "is_primary_key": False,
        }
        curated = {
            "field_name": "balance_num",
            "custom_comment": "用户结余金额",
            "enum_values": "[启用,禁用]",
            "checked": True,
        }
        table_schema = TableSchema(
            database="demo", table_name="account", description="账户表", aliases=["账户信息表"]
        )
        col = loader._build_column(
            db="demo",
            table_name="account",
            raw=raw,
            curated_field=curated,
            fk_map={"user_id": "users.id"},
            samples=["100", "200"],
            table_schema=table_schema,
        )
        # 自定义注释优先于库注释
        self.assertEqual(col.description, "用户结余金额")
        # 枚举值并入样例
        self.assertEqual(col.samples[:2], ["启用", "禁用"])
        # 同义词成为别名
        self.assertIn("余额", col.aliases)
        # 表描述/别名带下来
        self.assertEqual(col.table_description, "账户表")
        self.assertIn("账户信息表", col.table_aliases)
        # 语义角色
        self.assertEqual(col.semantic_role, "metric")
        # 类型/可空/主键
        self.assertEqual(col.data_type, "numeric(18,2)")
        self.assertFalse(col.nullable)
        self.assertFalse(col.is_primary_key)


class TestLoadConnection(unittest.TestCase):
    def _make_loader(self):
        loader = DeepDataSourceLoader(sample_size=3)
        conn = _FakeConn([
            # 样例行（取样 SQL 含 LIMIT :n）
            ("LIMIT :n", [
                {"ID": 1, "CREATIONTIME": "2024-01-01", "BALANCENUM": 100},
                {"ID": 2, "CREATIONTIME": "2024-02-02", "BALANCENUM": 200},
            ]),
            # 外键（SQL 含 contype）
            ("contype", [
                {"source_column": "CREATORUSERID", "target_table": "FUEL_CB_USER", "target_column": "ID", "constraint_name": "fk_user"},
            ]),
            # 字段清单（SQL 含 pg_attribute）
            ("pg_attribute", [
                {"column_name": "ID", "data_type": "bigint", "nullable": False, "comment": "主键Id", "is_primary_key": True},
                {"column_name": "CREATIONTIME", "data_type": "timestamp without time zone", "nullable": True, "comment": "创建时间", "is_primary_key": False},
                {"column_name": "BALANCENUM", "data_type": "numeric(18,2)", "nullable": True, "comment": "结算数量", "is_primary_key": False},
            ]),
            # 表清单（SQL 含 relkind）
            ("relkind", [
                {"table_name": "FUEL_CB_COALBALANCE", "table_comment": "燃煤采购结算主表"},
                {"table_name": "SKIP_TABLE", "table_comment": "已取消勾选"},
            ]),
        ])
        curated = [
            {"table_name": "FUEL_CB_COALBALANCE", "table_comment": "燃煤采购结算主表",
             "custom_comment": "燃煤采购结算", "checked": True, "fields": [
                 {"field_name": "BALANCENUM", "field_type": "numeric", "checked": True,
                  "custom_comment": "本次结算数量", "enum_values": ""},
             ]},
            {"table_name": "SKIP_TABLE", "table_comment": "", "custom_comment": "", "checked": False, "fields": []},
        ]
        return loader, conn, curated

    def test_load_connection(self):
        loader, conn, curated = self._make_loader()
        loaded = loader._load_connection(conn, db="demo", schema="public", curated=curated)

        # 只装载已勾选表
        self.assertIn("FUEL_CB_COALBALANCE", loaded.tables)
        self.assertNotIn("SKIP_TABLE", loaded.tables)
        # 表描述（自定义优先）
        self.assertEqual(loaded.tables["FUEL_CB_COALBALANCE"].description, "燃煤采购结算")
        # 主键收集
        self.assertEqual(loaded.tables["FUEL_CB_COALBALANCE"].primary_keys, ["ID"])
        # 字段数 = 3
        self.assertEqual(loaded.field_count, 3)
        # 自定义注释优先于库注释
        balance = next(c for c in loaded.columns if c.column_name == "BALANCENUM")
        self.assertEqual(balance.description, "本次结算数量")
        self.assertIn("100", balance.samples)
        # 外键关系
        self.assertEqual(len(loaded.relations), 1)
        self.assertEqual(loaded.relations[0].join_condition, "FUEL_CB_COALBALANCE.CREATORUSERID = FUEL_CB_USER.ID")
        # 主键字段语义角色
        id_col = next(c for c in loaded.columns if c.column_name == "ID")
        self.assertEqual(id_col.semantic_role, "join_key")

    def test_text_builder_from_loaded(self):
        loader, conn, curated = self._make_loader()
        loaded = loader._load_connection(conn, db="demo", schema="public", curated=curated)
        builder = SchemaIndexTextBuilder()
        docs = builder.build_many(loaded.columns)
        self.assertEqual(len(docs), 3)
        self.assertTrue(all(d.keyword_text and d.vector_text and d.rerank_text for d in docs))
        # vector_text 含业务含义
        balance_doc = next(d for d in docs if d.doc_id.endswith("BALANCENUM"))
        self.assertIn("本次结算数量", balance_doc.vector_text)


if __name__ == "__main__":
    unittest.main()
