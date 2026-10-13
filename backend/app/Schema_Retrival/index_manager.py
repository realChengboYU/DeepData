# -*- coding: utf-8 -*-
"""Schema 索引后台构建管理。

避免「首次访问 / 手动重建」时同步嵌入上千字段（几十秒）把 Web worker 卡死：
- ``ensure_index(source_id, user_key)``：非阻塞。已就绪则直接返回检索器；
  否则启动后台构建并返回 ``None + status``（调用方轮询 ``get_status``）。
- ``get_status(source_id)``：查询某个数据源索引的构建状态（idle/building/ready/error）。
- 每个 ``source_id`` 一把 lock：同一 source 不会并发重复构建。
"""
from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Dict, Optional, Tuple

from .hybrid import HybridSchemaRetriever
from .index_service import SchemaIndexService


@dataclass
class IndexStatus:
    source_id: str = ""
    status: str = "idle"  # idle | building | ready | error
    field_count: int = 0
    indexed_at: str = ""
    error: str = ""
    started_at: str = ""
    finished_at: str = ""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SchemaIndexManager:
    """后台构建 + 状态查询 + 同数据源并发锁。"""

    def __init__(self, service: SchemaIndexService, max_workers: int = 2):
        self.service = service
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="schema-index")
        self._status: Dict[str, IndexStatus] = {}
        self._retrievers: Dict[str, HybridSchemaRetriever] = {}
        self._locks: Dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()

    # ---------------- 对外 ----------------
    def ensure_index(
        self, source_id: str, user_key: str
    ) -> Tuple[Optional[HybridSchemaRetriever], Dict]:
        """非阻塞。就绪返回 (retriever, status)；否则触发后台构建并返回 (None, status)。"""
        retriever = self._retrievers.get(source_id)
        if retriever is not None:
            return retriever, self._ready_status(source_id, len(retriever.documents), "")

        retriever = self.service.load_index(source_id)
        if retriever is not None:
            self._retrievers[source_id] = retriever
            meta = self.service._get_store(source_id).get_meta()
            return retriever, self._ready_status(
                source_id, len(retriever.documents), meta.get("indexed_at", "")
            )

        started = self._trigger_build(source_id, user_key)
        return None, {"status": "building" if started else "building", "source_id": source_id}

    def get_status(self, source_id: str) -> Dict:
        st = self._status.get(source_id)
        if st is not None:
            return asdict(st)
        retriever = self.service.load_index(source_id)
        if retriever is not None:
            self._retrievers[source_id] = retriever
            meta = self.service._get_store(source_id).get_meta()
            return self._ready_status(source_id, len(retriever.documents), meta.get("indexed_at", ""))
        return {"status": "idle", "source_id": source_id, "field_count": 0}

    def rebuild(self, source_id: str, user_key: str) -> Tuple[Optional[HybridSchemaRetriever], Dict]:
        """强制重建：清缓存并触发后台构建。"""
        self._retrievers.pop(source_id, None)
        return self.ensure_index(source_id, user_key)

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False)

    # ---------------- 内部 ----------------
    def _trigger_build(self, source_id: str, user_key: str) -> bool:
        with self._locks_guard:
            lock = self._locks.setdefault(source_id, threading.Lock())
        if not lock.acquire(blocking=False):
            return False  # 已在构建，不重复
        self._status[source_id] = IndexStatus(
            source_id=source_id, status="building", started_at=_now()
        )
        self._executor.submit(self._do_build, source_id, user_key, lock)
        return True

    def _do_build(self, source_id: str, user_key: str, lock: threading.Lock) -> None:
        st = self._status.setdefault(source_id, IndexStatus(source_id=source_id))
        try:
            retriever = self.service.rebuild(source_id, user_key)
            self._retrievers[source_id] = retriever
            meta = self.service._get_store(source_id).get_meta()
            st.status = "ready"
            st.field_count = len(retriever.documents)
            st.indexed_at = meta.get("indexed_at", "")
            st.error = ""
        except Exception as exc:  # 记录错误状态，不抛给 worker
            st.status = "error"
            st.error = repr(exc)
        finally:
            st.finished_at = _now()
            lock.release()

    def _ready_status(self, source_id: str, field_count: int, indexed_at: str) -> Dict:
        return {
            "status": "ready",
            "source_id": source_id,
            "field_count": field_count,
            "indexed_at": indexed_at,
            "error": "",
        }
