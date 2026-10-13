from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class IndexTextBundle:
    """字段在不同检索阶段使用的索引文本。"""

    keyword_text: str = ""  # 关键词索引文本，用于 BM25 召回
    vector_text: str = ""   # 向量索引文本，用于语义召回
    rerank_text: str = ""   # 精排索引文本，用于 Rerank


@dataclass
class TableSchema:
    """表级 Schema，描述数据表的基础信息和业务含义。"""

    database: str
    table_name: str
    description: str = ""  # 表业务描述
    aliases: List[str] = field(default_factory=list)  # 表业务别名
    primary_keys: List[str] = field(default_factory=list)  # 主键字段（可能存在联合主键）


@dataclass
class ColumnSchema:
    """字段级 Schema，是 Schema 检索的基本单元。"""

    database: str
    table_name: str
    column_name: str
    data_type: str
    nullable: bool = True

    description: str = ""  # 字段业务含义
    aliases: List[str] = field(default_factory=list)  # 字段业务别名

    table_description: str = ""  # 所属表业务描述
    table_aliases: List[str] = field(default_factory=list)  # 所属表别名

    samples: List[str] = field(default_factory=list)  # 字段样例值
    value_range: str = ""  # 字段取值范围
    data_distribution: str = ""  # 字段数据分布

    business_usage: str = ""  # 字段业务用途
    semantic_role: str = ""  # 字段语义角色，如 metric、dimension、filter、time、join_key

    is_primary_key: bool = False
    foreign_key_ref: Optional[str] = None  # 外键目标，格式如 table.column，当前字段引用的是哪个表的主键

    # 每个 ColumnSchema 实例都拥有自己完整独立的 index_texts 对象
    index_texts: IndexTextBundle = field(default_factory=IndexTextBundle)  # 三级索引文本

    @property
    def full_name(self) -> str:
        """字段全限定名。"""
        return f"{self.database}.{self.table_name}.{self.column_name}"


@dataclass
class TableRelation:
    """表间关联关系，用于构建 SchemaGraph。"""

    database: str
    source_table: str
    source_column: str
    target_table: str
    target_column: str
    relation_type: str = "foreign_key"  # 关系类型，如 foreign_key、business_relation
    description: str = ""  # 关系业务含义

    @property
    def relation_key(self) -> str:
        """
        表关系索引键。

        两阶段字段检索后，只能拿到命中的字段和字段所属表。
        构建 SchemaGraph 时，需要通过两张表的表名反查关联键。

        为了让 (表A, 表B) 和 (表B, 表A) 都能查到同一条关系，
        这里使用排序后的无向 pair key。
        """
        # 不管谁前谁后都按照字母序排序
        left, right = sorted([self.source_table, self.target_table])
        return f"{self.database}:{left}__{right}"

    @property
    def join_condition(self) -> str:
        """SQL Join 条件。"""
        return (
            f"{self.source_table}.{self.source_column} = "
            f"{self.target_table}.{self.target_column}"
        )


# 实际被检索和索引的处理单元
@dataclass
class FieldDocument:
    """字段级检索文档，是实际参与召回和排序的文档单元。"""

    doc_id: str
    column: ColumnSchema
    keyword_text: str  # 关键词召回文本
    vector_text: str   # 向量召回文本
    rerank_text: str   # 精排文本


# 分析结构的 schema
@dataclass
class SchemaHit:
    """Schema 检索命中结果，记录字段及各阶段得分。"""

    doc_id: str
    score: float
    column: ColumnSchema

    keyword_rank: Optional[int] = None  # 关键词召回排名
    vector_rank: Optional[int] = None   # 向量召回排名
    rrf_score: float = 0.0              # RRF 融合得分
    rerank_score: Optional[float] = None  # Rerank 得分


@dataclass
class SchemaGraph:
    """面向当前 Query 构建的 Schema 子图，作为 CoT 和 SQL 生成上下文。"""

    database: str
    tables: Dict[str, TableSchema]  # 相关表集合
    columns: Dict[str, List[ColumnSchema]]  # 按表分组的相关字段
    relations: List[TableRelation]  # 相关表间关系

    def to_prompt_context(self) -> str:
        """转换为可放入 Prompt 的 Schema 上下文。"""
        lines: List[str] = []

        lines.append(f"数据库：{self.database}")
        lines.append("")

        for table_name, table in self.tables.items():
            lines.append(f"表名：{table_name}")

            if table.description:
                lines.append(f"表格摘要：{table.description}")

            if table.aliases:
                lines.append(f"表别名：{', '.join(table.aliases)}")

            if table.primary_keys:
                lines.append(f"主键：{', '.join(table.primary_keys)}")

            lines.append("字段：")

            for col in self.columns.get(table_name, []):
                lines.append(f"- 字段名：{col.column_name}")
                lines.append(f"  数据类型：{col.data_type}")

                if col.description:
                    lines.append(f"  字段含义：{col.description}")

                if col.aliases:
                    lines.append(f"  字段别名：{', '.join(col.aliases)}")

                if col.semantic_role:
                    lines.append(f"  字段角色：{col.semantic_role}")

                if col.samples:
                    lines.append(f"  样例值：{', '.join(col.samples[:8])}")

                if col.value_range:
                    lines.append(f"  取值范围：{col.value_range}")

                if col.data_distribution:
                    lines.append(f"  数据分布：{col.data_distribution}")

                if col.business_usage:
                    lines.append(f"  业务用途：{col.business_usage}")

            lines.append("")

        if self.relations:
            lines.append("表关联关系：")

            for rel in self.relations:
                description = f"；关联含义：{rel.description}" if rel.description else ""
                lines.append(
                    f"- {rel.source_table}.{rel.source_column} "
                    f"↔ {rel.target_table}.{rel.target_column}"
                    f"{description}"
                )

        return "\n".join(lines)
