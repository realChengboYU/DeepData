# -*- coding: utf-8 -*-
"""字段级 Schema 索引「构造过程」演示。

运行：cd backend && .venv\\Scripts\\python.exe -m app.Schema_Indexing.demo
"""
from __future__ import annotations

from .index_builder import SchemaIndexBuilder
from .objects import ColumnSchema, IndexTextBundle, TableRelation
from .text_builder import SchemaIndexTextBuilder


def build_demo_columns() -> list[ColumnSchema]:
    """构造 Demo 字段元数据（字段描述字段本身，表关系单独用 TableRelation 表达）。"""
    return [
        ColumnSchema(
            database="trade_db",
            table_name="trade_summary",
            column_name="user_id",
            data_type="int",
            nullable=False,
            table_description="该表记录用户交易汇总信息，包括用户累计交易笔数、交易金额以及交易活跃度等内容。",
            table_aliases=["用户交易汇总表", "交易统计表"],
            description="用户唯一标识。",
            aliases=["用户ID", "客户ID"],
            samples=["1001", "1002", "1003"],
            business_usage="用于唯一标识交易汇总表中的用户。",
            semantic_role="join_key",
            is_primary_key=True,
        ),
        ColumnSchema(
            database="trade_db",
            table_name="trade_summary",
            column_name="total_trade_count",
            data_type="int",
            nullable=False,
            table_description="该表记录用户交易汇总信息，包括用户累计交易笔数、交易金额以及交易活跃度等内容。",
            table_aliases=["用户交易汇总表", "交易统计表"],
            description="用户累计交易总笔数。",
            aliases=["总交易笔数", "累计交易笔数", "交易笔数", "交易次数"],
            samples=["120", "5800", "56000", "102430"],
            value_range="整数，>= 0",
            data_distribution="多数用户集中在0-50区间，高频交易用户可能超过50000。",
            business_usage="用于衡量用户交易活跃程度，筛选高频交易用户。",
            semantic_role="metric_filter",
            index_texts=IndexTextBundle(
                keyword_text=(
                    "total_trade_count 总交易笔数 累计交易笔数 交易笔数 "
                    "交易次数 高频交易 用户交易汇总表 交易统计表"
                ),
                vector_text=(
                    "字段名：total_trade_count。所属表：trade_summary。"
                    "该字段表示用户累计交易总笔数，用于衡量用户交易活跃程度，"
                    "可用于筛选高频交易用户。"
                ),
                rerank_text=(
                    "数据库：trade_db\n"
                    "表名：trade_summary\n"
                    "字段名：total_trade_count\n"
                    "数据类型：int\n"
                    "字段含义：用户累计交易总笔数。\n"
                    "字段别名：总交易笔数、累计交易笔数、交易笔数、交易次数。\n"
                    "取值范围：整数，>= 0。\n"
                    "数据分布：高频交易用户可能超过50000。\n"
                    "业务用途：用于筛选总交易笔数大于某个阈值的用户。"
                ),
            ),
        ),
    ]


def build_demo_relations() -> list[TableRelation]:
    """构造 Demo 表关系。表间 join 信息不要写进字段 business_usage，作为独立图边存储。"""
    return [
        TableRelation(
            database="trade_db",
            source_table="trade_summary",
            source_column="user_id",
            target_table="interest_info",
            target_column="user_id",
            relation_type="business_relation",
            description="通过用户ID关联用户交易汇总信息与用户利率信息。",
        )
    ]


def main() -> None:
    print("=" * 80)
    print("Schema_Indexing 构造过程 Demo")
    print("=" * 80)

    builder = SchemaIndexTextBuilder()
    index_builder = SchemaIndexBuilder(builder)
    columns = build_demo_columns()
    relations = build_demo_relations()

    print("\n[1] 构建字段三级索引文本：")
    documents = index_builder.build_documents_only(columns)
    for index, doc in enumerate(documents, start=1):
        print(f"\n{index}. {doc.doc_id}")
        print(f"keyword_text: {doc.keyword_text}")
        print(f"vector_text : {doc.vector_text}")
        print(f"rerank_text : {doc.rerank_text}")

    print("\n[2] 构造结果：")
    result = index_builder.build(columns=columns, relations=relations)
    print(f"field_document_count: {result.field_document_count}")
    print(f"relation_count      : {result.relation_count}")

    print("\n[3] 表关系 key / join 条件：")
    for rel in relations:
        print(f"relation_key    : {rel.relation_key}")
        print(f"join_condition  : {rel.join_condition}")


if __name__ == "__main__":
    main()
