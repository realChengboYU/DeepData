"""字段 Schema 索引 / 检索接口。

- 构建 / 重建：后台线程执行（避免同步嵌入几十秒卡死 worker），返回 status。
- 状态查询：idle / building / ready / error。
- 检索：按 query 返回命中字段 + Schema 上下文（prompt）。
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.routers.ask import get_user_key
from app.services import datasource_store as ds
from app.services.schema_index import get_schema_context, get_schema_index_manager

router = APIRouter(prefix="/api", tags=["schema-index"])


class SearchIn(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    top_k: int = Field(10, ge=1, le=50)


def _get_owned(source_id: str, user_key: str) -> dict:
    src = ds.get_source(source_id, user_key)
    if src is None:
        raise HTTPException(status_code=404, detail="数据源不存在")
    return src


@router.get("/datasources/{source_id}/schema-index/status")
def schema_index_status(source_id: str, user_key: str = Depends(get_user_key)) -> dict:
    _get_owned(source_id, user_key)
    status = get_schema_index_manager().get_status(source_id)
    return {"source_id": source_id, **status}


@router.post("/datasources/{source_id}/schema-index/build")
def schema_index_build(source_id: str, user_key: str = Depends(get_user_key)) -> dict:
    """触发（或复用）索引构建。未就绪则后台构建，返回当前状态。"""
    _get_owned(source_id, user_key)
    manager = get_schema_index_manager()
    _, status = manager.ensure_index(source_id, user_key)
    return {"source_id": source_id, **status}


@router.post("/datasources/{source_id}/schema-index/rebuild")
def schema_index_rebuild(source_id: str, user_key: str = Depends(get_user_key)) -> dict:
    """强制重建（清空旧索引再后台构建）。"""
    _get_owned(source_id, user_key)
    manager = get_schema_index_manager()
    _, status = manager.rebuild(source_id, user_key)
    return {"source_id": source_id, **status}


@router.post("/datasources/{source_id}/schema-index/search")
def schema_index_search(
    source_id: str, payload: SearchIn, user_key: str = Depends(get_user_key)
) -> dict:
    """检索：返回命中字段 + Schema 上下文。索引未就绪返回 409。"""
    _get_owned(source_id, user_key)
    hits, prompt = get_schema_context(source_id, user_key, payload.query, top_k=payload.top_k)
    if hits is None:
        status = get_schema_index_manager().get_status(source_id)
        raise HTTPException(
            status_code=409,
            detail=f"索引未就绪（{status.get('status')}），请先构建。",
        )
    return {
        "source_id": source_id,
        "query": payload.query,
        "hits": [
            {
                "doc_id": h.doc_id,
                "score": round(float(h.score), 4),
                "table": h.column.table_name,
                "column": h.column.column_name,
                "data_type": h.column.data_type,
                "description": h.column.description,
                "semantic_role": h.column.semantic_role,
            }
            for h in hits
        ],
        "schema_context": prompt,
    }


@router.get("/datasources/{source_id}/schema-index/context")
def schema_index_context(
    source_id: str,
    user_key: str = Depends(get_user_key),
    query: Optional[str] = "",
    top_k: int = 10,
) -> dict:
    """直接取 Schema 上下文（供 agent / 内部拼接提示）。索引未就绪返回空 context。"""
    _get_owned(source_id, user_key)
    hits, prompt = get_schema_context(source_id, user_key, query or "", top_k=top_k)
    return {"source_id": source_id, "ready": hits is not None, "schema_context": prompt}
