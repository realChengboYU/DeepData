# -*- coding: utf-8 -*-
"""SchemaGraph 构建器：把检索命中的 ``SchemaHit`` 拼成面向当前 Query 的 Schema 子图。

子图再经 ``SchemaGraph.to_prompt_context()`` 转成可注入 agent 的上下文
（表 + 相关字段 + 表关联关系）。
"""
from __future__ import annotations

from typing import Dict, List, Optional

from app.Schema_Indexing.objects import (
    SchemaGraph,
    SchemaHit,
    TableRelation,
    TableSchema,
)


class SchemaGraphBuilder:
    """把命中字段聚合成 SchemaGraph，并外扩一跳表关联。"""

    def __init__(
        self,
        tables: Optional[Dict[str, TableSchema]] = None,
        relations: Optional[List[TableRelation]] = None,
    ) -> None:
        self.tables = tables or {}
        self.relations = relations or []

    def build(self, hits: List[SchemaHit]) -> SchemaGraph:
        if not hits:
            return SchemaGraph(database="", tables={}, columns={}, relations=[])

        database = hits[0].column.database
        seed_tables = {hit.column.table_name for hit in hits}

        # 外扩一跳：命中表 + 与命中表有关系的邻接表
        include = self._expand_tables(seed_tables)

        # 相关字段按表分组（去重，保持命中顺序）
        columns: Dict[str, list] = {}
        seen = set()
        for hit in hits:
            col = hit.column
            key = (col.table_name, col.column_name)
            if key in seen:
                continue
            seen.add(key)
            columns.setdefault(col.table_name, []).append(col)

        # 相关表（用完整表元数据，缺失回退）
        tables: Dict[str, TableSchema] = {}
        for name in include:
            tables[name] = self.tables.get(name) or TableSchema(
                database=database,
                table_name=name,
                description=columns[name][0].table_description if columns.get(name) else "",
                aliases=columns[name][0].table_aliases if columns.get(name) else [],
            )

        # 相关表间关系（两端都在 include 集合内）
        relations = [
            rel
            for rel in self.relations
            if rel.source_table in include and rel.target_table in include
        ]

        return SchemaGraph(
            database=database, tables=tables, columns=columns, relations=relations
        )

    def _expand_tables(self, seed: set) -> set:
        include = set(seed)
        for rel in self.relations:
            if rel.source_table in seed or rel.target_table in seed:
                include.add(rel.source_table)
                include.add(rel.target_table)
        return include
