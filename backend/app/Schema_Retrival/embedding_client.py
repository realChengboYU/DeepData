# -*- coding: utf-8 -*-
"""Embedding 客户端：调用兼容 OpenAI 的 ``/v1/embeddings`` 服务。

配置来自环境变量：
- ``EMBED_MODEL``        模型名（默认 qwen3-embedding）
- ``EMBED_DIMENSIONS``   向量维度（默认 2560）
- ``EMBED_HOST``         服务基址，如 http://172.168.100.146:4651/v1（末尾可带 /v1）
- ``EMBED_API_KEY``      可选 Bearer key
- ``EMBED_TIMEOUT``      请求超时（秒，默认 90）
- ``EMBED_BATCH_SIZE``   单批文本条数（默认 32）

``EmbeddingClient.embed_texts`` 返回 L2 归一化的 ``numpy.float32`` 矩阵。
未配置 ``EMBED_HOST`` 时直接抛错。
"""
from __future__ import annotations

import json
import os
import urllib.request
from dataclasses import dataclass
from typing import List

from dotenv import load_dotenv

import numpy as np

# 加载 backend/.env 里的 EMBED_*，确保在 EmbeddingConfig 用 os.getenv 取值前先注入。
load_dotenv()


@dataclass
class EmbeddingConfig:
    model: str = os.getenv("EMBED_MODEL", "qwen3-embedding")
    dimensions: int = int(os.getenv("EMBED_DIMENSIONS", "2560"))
    host: str = os.getenv("EMBED_HOST", "")
    api_key: str = os.getenv("EMBED_API_KEY", "")
    timeout: int = int(os.getenv("EMBED_TIMEOUT", "90"))
    batch_size: int = int(os.getenv("EMBED_BATCH_SIZE", "32"))
    # 是否把 dimensions 放进请求体。部分服务（如 qwen3-embedding）不支持
    # Matryoshka，带 dimensions 会返回 400；默认不发送，向量维度取服务端返回值。
    send_dimensions: bool = os.getenv("EMBED_SEND_DIMENSIONS", "0") in ("1", "true", "True", "yes")

    @property
    def embeddings_url(self) -> str:
        """拼出 ``/embeddings`` 完整地址。"""
        base = (self.host or "").strip().rstrip("/")
        if base.endswith("/embeddings"):
            return base
        return f"{base}/embeddings"


class EmbeddingClient:
    """调用服务端 Embedding 接口生成字段向量。"""

    def __init__(self, config: EmbeddingConfig | None = None):
        self.config = config or EmbeddingConfig()

    def embed_texts(self, texts: List[str]) -> np.ndarray:
        """批量生成文本向量，返回 (len(texts), dimensions) float32 归一化矩阵。"""
        if not texts:
            return np.empty((0, self.config.dimensions), dtype=np.float32)

        if not self.config.host:
            raise ValueError("未配置 EMBED_HOST，无法生成向量。")

        vectors: List[np.ndarray] = []
        for start in range(0, len(texts), self.config.batch_size):
            batch = texts[start : start + self.config.batch_size]
            batch_vec = self._call(batch)
            vectors.append(batch_vec)
        return self._normalize(np.concatenate(vectors, axis=0))

    def _call(self, texts: List[str]) -> np.ndarray:
        """对一批文本调用 ``/v1/embeddings``。"""
        url = self.config.embeddings_url
        payload: dict = {
            "model": self.config.model,
            "input": texts,
            "encoding_format": "float",
        }
        if self.config.send_dimensions:
            payload["dimensions"] = self.config.dimensions
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        headers = {"Content-Type": "application/json"}
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"

        request = urllib.request.Request(url, data=data, headers=headers, method="POST")
        # 不走系统代理：本机环境变量里 HTTP_PROXY / NO_PROXY 含 IPv6（::1,[::1]）条目，
        # urllib 解析会崩溃或把内网 embedding 请求打到坏代理而 502；内网服务应直连。
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(request, timeout=self.config.timeout) as response:
                body = response.read().decode("utf-8")
                result = json.loads(body)
        except Exception as exc:  # 网络/鉴权/超时等
            raise RuntimeError(f"调用 Embedding 接口失败：{exc}") from exc

        try:
            data_items = sorted(result["data"], key=lambda item: item.get("index", 0))
            embeddings = [item["embedding"] for item in data_items]
        except Exception as exc:
            raise RuntimeError(f"解析 Embedding 返回失败：{result}") from exc

        return np.array(embeddings, dtype=np.float32)

    @staticmethod
    def _normalize(vectors: np.ndarray) -> np.ndarray:
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        return vectors / np.maximum(norms, 1e-8)
