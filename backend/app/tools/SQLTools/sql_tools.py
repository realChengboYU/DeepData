"""SQL 数据库工具包：基于 langchain_community 的 SQLDatabaseToolkit。

提供给智能体绑定的 4 个工具：
- sql_db_list_tables：列出数据库所有表（ListSQLDatabaseTool）
- sql_db_schema：获取指定表的结构/字段（InfoSQLDatabaseTool）
- sql_db_query：执行一条 SQL 查询并返回结果（QuerySQLDatabaseTool）
- sql_db_query_checker：用 LLM 校验 SQL 查询是否正确/安全（QuerySQLCheckerTool）

数据源连接串来源（按优先级）：
  1. 显式传入的 db_url
  2. 环境变量 SQL_DATABASE_URL

注意：不会回退到应用自身的 DATABASE_URL（那是 checkpointer 用的消息存储库），
避免把 SQL 工具暴露到内部表。后续「数据源管理」模块可把用户选中的数据源连接串
注入 get_sql_tools(llm, db_url=...)。
未配置任何数据源连接串时返回空列表（智能体退化为纯对话，不绑定 SQL 工具）。
"""

import os
from typing import Optional, Sequence

from langchain_community.agent_toolkits import SQLDatabaseToolkit
from langchain_community.utilities.sql_database import SQLDatabase

# 4 个工具的稳定名字（供上层识别 / 校验）
SQL_TOOL_NAMES = [
    "sql_db_list_tables",
    "sql_db_schema",
    "sql_db_query",
    "sql_db_query_checker",
]


def resolve_db_url(db_url: Optional[str] = None) -> Optional[str]:
    """按优先级解析数据源连接串（仅限显式数据源，不回退到内部 DATABASE_URL）。"""
    if db_url:
        return db_url
    return os.getenv("SQL_DATABASE_URL") or None


def get_sql_database(db_url: Optional[str] = None) -> Optional[SQLDatabase]:
    """构造 SQLDatabase；无连接串或连接失败时返回 None。

    给引擎加超时（连接 10s、PG 单条查询 30s）：避免慢查询 / 锁等待 / 网络抖动
    把 worker 线程无限卡死——多个请求叠加会耗尽线程池，拖垮整个后端（表现为「卡在思考」）。
    """
    url = resolve_db_url(db_url)
    if not url:
        return None
    try:
        from sqlalchemy import create_engine

        connect_args = {"connect_timeout": 10}
        if url.startswith("postgresql") or url.startswith("postgres"):
            connect_args["options"] = "-c statement_timeout=30000"  # 单条查询最多 30s
        engine = create_engine(
            url,
            pool_pre_ping=True,
            pool_recycle=1800,
            connect_args=connect_args,
        )
        return SQLDatabase(engine)
    except Exception:
        return None


def get_sql_tools(llm, db_url: Optional[str] = None) -> Sequence:
    """返回 SQLDatabaseToolkit 的 4 个 SQL 工具。

    未配置数据源连接串或 llm 为空时返回空列表（不会抛出，智能体沿用纯对话）。
    """
    if llm is None:
        return []
    db = get_sql_database(db_url)
    if db is None:
        return []
    try:
        toolkit = SQLDatabaseToolkit(db=db, llm=llm)
        return toolkit.get_tools()
    except Exception:
        return []
