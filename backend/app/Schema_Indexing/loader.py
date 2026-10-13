# -*- coding: utf-8 -*-
"""PostgreSQL 装载器：把 DeepData 数据源装载成 Schema 索引的原始输入。

职责：
- 读取数据源连接（get_source）与策展表/字段（get_tables，含自定义注释、枚举值、勾选）。
- 对目标库做**实时内省**：表、字段（类型/可空/主键/外键/注释）、字段样例。
- 合并策展信息（自定义注释优先于库注释；枚举值并入样例；未勾选字段跳过）。
- 产出 ``LoadedSchema``（TableSchema / ColumnSchema / TableRelation），交给
  ``SchemaIndexTextBuilder`` 构造三级索引文本。

说明：semantic_role 采用轻量启发式推断（join_key / time / metric / dimension），
便于检索文本；后续可由用户/策展信息精修。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from sqlalchemy import create_engine, text

from app.services.datasource_store import build_pg_url, get_source, get_tables

from .objects import ColumnSchema, TableRelation, TableSchema


@dataclass
class LoadedSchema:
    """装载结果：表、字段、表关系。"""

    database: str
    tables: Dict[str, TableSchema] = field(default_factory=dict)
    columns: List[ColumnSchema] = field(default_factory=list)
    relations: List[TableRelation] = field(default_factory=list)

    @property
    def field_count(self) -> int:
        return len(self.columns)


# 表清单（含表注释）
_TABLE_QUERY = """
SELECT c.relname AS table_name, COALESCE(d.description, '') AS table_comment
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = 0
WHERE n.nspname = :schema AND c.relkind IN ('r','v','m')
ORDER BY c.relname
LIMIT 2000
"""

# 字段清单（类型/可空/主键/注释）
_COLUMN_QUERY = """
SELECT a.attname AS column_name,
       format_type(a.atttypid, a.atttypmod) AS data_type,
       NOT a.attnotnull AS nullable,
       COALESCE(d.description, '') AS comment,
       EXISTS(
         SELECT 1 FROM pg_index i
         WHERE i.indrelid = a.attrelid AND i.indisprimary
           AND a.attnum = ANY(i.indkey)
       ) AS is_primary_key
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = a.attnum
WHERE n.nspname = :schema AND c.relname = :table
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum
"""

# 单列表外键（取每个约束的第 1 列，覆盖常见主外键）
_FK_QUERY = """
SELECT
  (SELECT a.attname
     FROM unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord)
     JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = u.attnum
     WHERE u.ord = 1) AS source_column,
  (SELECT tc.relname FROM pg_class tc WHERE tc.oid = con.confrelid) AS target_table,
  (SELECT a.attname
     FROM unnest(con.confkey) WITH ORDINALITY AS u(attnum, ord)
     JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = u.attnum
     WHERE u.ord = 1) AS target_column,
  COALESCE(con.conname, '') AS constraint_name
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE con.contype = 'f' AND n.nspname = :schema AND c.relname = :table
"""


class DeepDataSourceLoader:
    """从 DeepData 数据源（PostgreSQL）装载字段级 Schema。"""

    def __init__(
        self,
        sample_size: int = 5,
        synonyms: Optional[Dict[str, List[str]]] = None,
        database_name: Optional[str] = None,
    ) -> None:
        self.sample_size = sample_size
        self.synonyms = synonyms or {}
        self.database_name = database_name  # 缺省用数据源 dbname

    # ------------------------------------------------------------------ #
    # 对外入口
    # ------------------------------------------------------------------ #
    def load(self, source_id: str, user_key: str) -> LoadedSchema:
        """按数据源 id + user_key 装载。"""
        src = get_source(source_id, user_key)
        if not src:
            raise ValueError(f"数据源不存在: {source_id}")
        curated = get_tables(source_id)
        return self.load_from_source(src, curated)

    def load_from_source(self, src: dict, curated: List[dict]) -> LoadedSchema:
        """用已取到的数据源记录 + 策展表/字段装载（便于测试注入）。"""
        db = self.database_name or (src.get("dbname") or "main")
        schema = src.get("schema") or "public"
        url = build_pg_url(
            src["host"], src["port"], src["dbname"], src["username"],
            src.get("password") or "", ssl=bool(src.get("ssl")),
        )
        engine = create_engine(url, connect_args={"connect_timeout": 8})
        try:
            with engine.connect() as conn:
                return self._load_connection(conn, db, schema, curated)
        finally:
            engine.dispose()

    # ------------------------------------------------------------------ #
    # 核心装载
    # ------------------------------------------------------------------ #
    def _load_connection(
        self, conn: Any, db: str, schema: str, curated: List[dict]
    ) -> LoadedSchema:
        curated_by_name = {t["table_name"]: t for t in curated}

        all_tables = {
            row["table_name"]: row["table_comment"]
            for row in self._query(conn, _TABLE_QUERY, {"schema": schema})
        }

        if curated_by_name:
            # 只装载已勾选（checked=True）的表；表已从库中移除则跳过。
            target = {
                name: meta
                for name, meta in curated_by_name.items()
                if meta.get("checked") and name in all_tables
            }
        else:
            # 未策展：回退到装载库内全部业务表。
            target = {
                name: {
                    "table_name": name,
                    "checked": True,
                    "table_comment": all_tables.get(name, ""),
                    "custom_comment": "",
                    "fields": [],
                }
                for name in all_tables
            }

        tables: Dict[str, TableSchema] = {}
        columns: List[ColumnSchema] = []
        relations: List[TableRelation] = []

        for table_name, meta in target.items():
            table_comment = str(meta.get("table_comment") or all_tables.get(table_name, "") or "")
            custom_comment = str(meta.get("custom_comment") or "")

            raw_cols = self._query(
                conn, _COLUMN_QUERY, {"schema": schema, "table": table_name}
            )
            if not raw_cols:
                continue  # 表不存在 / 空表无字段

            fks = self._query(conn, _FK_QUERY, {"schema": schema, "table": table_name})
            fk_map = {
                fk["source_column"]: f"{fk['target_table']}.{fk['target_column']}"
                for fk in fks
            }

            primary_keys = [
                row["column_name"] for row in raw_cols if bool(row["is_primary_key"])
            ]

            table_schema = TableSchema(
                database=db,
                table_name=table_name,
                description=custom_comment or table_comment,
                aliases=[],
                primary_keys=primary_keys,
            )
            tables[table_name] = table_schema

            curated_fields = {
                f["field_name"]: f for f in (meta.get("fields") or [])
            }
            samples = self._sample(conn, schema, table_name, [r["column_name"] for r in raw_cols])

            for rc in raw_cols:
                cmeta = curated_fields.get(rc["column_name"])
                if cmeta is not None and cmeta.get("checked") is False:
                    continue  # 字段被取消勾选
                columns.append(
                    self._build_column(
                        db=db,
                        table_name=table_name,
                        raw=rc,
                        curated_field=cmeta,
                        fk_map=fk_map,
                        samples=samples.get(rc["column_name"], []),
                        table_schema=table_schema,
                    )
                )

            for fk in fks:
                relations.append(
                    TableRelation(
                        database=db,
                        source_table=table_name,
                        source_column=str(fk["source_column"] or ""),
                        target_table=str(fk["target_table"] or ""),
                        target_column=str(fk["target_column"] or ""),
                        relation_type="foreign_key",
                    )
                )

        return LoadedSchema(database=db, tables=tables, columns=columns, relations=relations)

    # ------------------------------------------------------------------ #
    # 字段构造
    # ------------------------------------------------------------------ #
    def _build_column(
        self,
        db: str,
        table_name: str,
        raw: dict,
        curated_field: Optional[dict],
        fk_map: Dict[str, str],
        samples: List[str],
        table_schema: TableSchema,
    ) -> ColumnSchema:
        """合并实时字段信息与策展信息，构造 ColumnSchema。"""
        comment = ""
        if curated_field:
            comment = str(curated_field.get("custom_comment") or "") or str(raw.get("comment") or "")
        else:
            comment = str(raw.get("comment") or "")

        fk_ref = fk_map.get(raw["column_name"])

        aliases: List[str] = []
        # 领域同义词：命中则追加为别名（增强检索文本）。
        for alias in self.synonyms.get(raw["column_name"], []):
            if alias not in aliases:
                aliases.append(alias)

        enum_samples = self._parse_enum(curated_field.get("enum_values")) if curated_field else []
        merged_samples = list(dict.fromkeys(enum_samples + list(samples)))

        semantic_role = self._infer_semantic_role(
            raw["column_name"], bool(raw.get("is_primary_key")), fk_ref
        )

        return ColumnSchema(
            database=db,
            table_name=table_name,
            column_name=str(raw["column_name"]),
            data_type=str(raw.get("data_type") or ""),
            nullable=bool(raw.get("nullable", True)),
            description=comment,
            aliases=aliases,
            table_description=table_schema.description,
            table_aliases=list(table_schema.aliases),
            samples=merged_samples,
            business_usage="",
            semantic_role=semantic_role,
            is_primary_key=bool(raw.get("is_primary_key")),
            foreign_key_ref=fk_ref,
        )

    # ------------------------------------------------------------------ #
    # 内省辅助
    # ------------------------------------------------------------------ #
    def _sample(self, conn: Any, schema: str, table: str, columns: List[str]) -> Dict[str, List[str]]:
        """对每张表取一次样例行，按列聚合去重的非空样例值。"""
        if not columns:
            return {}
        quoted_cols = ", ".join('"%s"' % c.replace('"', '""') for c in columns)
        table_ident = '"%s"."%s"' % (schema.replace('"', '""'), table.replace('"', '""'))
        sql = f"SELECT {quoted_cols} FROM {table_ident} LIMIT :n"
        rows = self._query(conn, sql, {"n": max(1, int(self.sample_size))})
        out: Dict[str, List[str]] = {c: [] for c in columns}
        for row in rows:
            for col in columns:
                value = row.get(col)
                if value is not None:
                    sval = str(value)
                    if sval not in out[col]:
                        out[col].append(sval)
        return out

    @staticmethod
    def _query(conn: Any, sql: str, params: Optional[dict] = None) -> List[dict]:
        return conn.execute(text(sql), params or {}).mappings().all()

    # ------------------------------------------------------------------ #
    # 纯函数：可单测
    # ------------------------------------------------------------------ #
    @staticmethod
    def _parse_enum(raw: Optional[str]) -> List[str]:
        """把枚举值字符串（如 `启用,禁用` / `['a','b']` / `{是,否}`）拆成列表。"""
        if not raw:
            return []
        cleaned = raw.strip().strip("[]{}()")
        if not cleaned:
            return []
        parts = re.split(r"[,\uFF0C;;；\n]+", cleaned)
        out: List[str] = []
        for part in parts:
            p = part.strip().strip("'\"").strip()
            if p:
                out.append(p)
        return out

    @staticmethod
    def _infer_semantic_role(name: str, is_primary_key: bool, fk_ref: Optional[str]) -> str:
        """轻量推断字段语义角色，用于增强检索文本。"""
        n = (name or "").lower()
        if (
            is_primary_key
            or fk_ref is not None
            or n.endswith(("_id", "userid", "uid"))
            or n in ("id", "uid")
        ):
            return "join_key"
        if any(k in n for k in ("time", "date", "_dt", "_at", "_ts", "day", "month", "year")):
            return "time"
        if any(k in n for k in ("count", "amount", "num", "qty", "price", "rate", "_amt", "_sum", "total", "revenue", "sales", "value")):
            return "metric"
        if any(k in n for k in ("name", "type", "status", "code", "category", "level", "flag", "region")):
            return "dimension"
        return ""
