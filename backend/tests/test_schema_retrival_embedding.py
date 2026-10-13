# -*- coding: utf-8 -*-
"""Schema_Retrival Embedding client 单测。"""
import json
import os
import unittest
from unittest import mock

import numpy as np

from app.Schema_Retrival import EmbeddingClient, EmbeddingConfig


class TestEmbeddingConfig(unittest.TestCase):
    def test_url_build_from_host_with_v1(self):
        cfg = EmbeddingConfig(host="http://172.168.100.146:4651/v1")
        self.assertEqual(cfg.embeddings_url, "http://172.168.100.146:4651/v1/embeddings")

    def test_url_build_no_trailing_slash(self):
        cfg = EmbeddingConfig(host="http://x:1/v1/")
        self.assertEqual(cfg.embeddings_url, "http://x:1/v1/embeddings")

    def test_url_already_embeddings(self):
        cfg = EmbeddingConfig(host="http://x:1/v1/embeddings")
        self.assertEqual(cfg.embeddings_url, "http://x:1/v1/embeddings")


class TestEmbeddingClientRealPath(unittest.TestCase):
    def test_call_and_parse(self):
        captured = {}

        def fake_urlopen(request, timeout=None):
            captured["data"] = request.data

            class _Resp:
                def read(self):
                    return json.dumps({
                        "data": [
                            {"index": 1, "embedding": [0.0, 1.0, 0.0]},
                            {"index": 0, "embedding": [1.0, 0.0, 0.0]},
                        ]
                    }).encode("utf-8")

                def __enter__(self):
                    return self

                def __exit__(self, *a):
                    return False

            return _Resp()

        cfg = EmbeddingConfig(host="http://host/v1", model="qwen3-embedding", dimensions=3, batch_size=10)
        client = EmbeddingClient(cfg)
        with mock.patch("app.Schema_Retrival.embedding_client.urllib.request.urlopen", fake_urlopen):
            vec = client.embed_texts(["字段名：总量", "字段名：时间"])

        # data 会按 index 排序：index=0 在前
        self.assertEqual(vec.shape, (2, 3))
        self.assertTrue(np.allclose(vec[0], [1.0, 0.0, 0.0]))  # 归一化后仍为 [1,0,0]
        self.assertTrue(np.allclose(vec[1], [0.0, 1.0, 0.0]))

        # 默认不发送 dimensions（qwen3-embedding 不支持 Matryoshka）
        payload = json.loads(captured["data"])
        self.assertNotIn("dimensions", payload)
        self.assertEqual(payload["model"], "qwen3-embedding")

    def test_send_dimensions_when_enabled(self):
        captured = {}

        def fake_urlopen(request, timeout=None):
            captured["data"] = request.data

            class _Resp:
                def read(self):
                    return json.dumps({
                        "data": [{"index": 0, "embedding": [1.0, 2.0, 3.0]}]
                    }).encode("utf-8")

                def __enter__(self):
                    return self

                def __exit__(self, *a):
                    return False

            return _Resp()

        cfg = EmbeddingConfig(host="http://host/v1", dimensions=3, batch_size=10, send_dimensions=True)
        client = EmbeddingClient(cfg)
        with mock.patch("app.Schema_Retrival.embedding_client.urllib.request.urlopen", fake_urlopen):
            client.embed_texts(["x"])
        payload = json.loads(captured["data"])
        self.assertEqual(payload["dimensions"], 3)

    def test_missing_host_raises(self):
        cfg = EmbeddingConfig(host="", dimensions=16)
        client = EmbeddingClient(cfg)
        with self.assertRaises(ValueError):
            client.embed_texts(["任意"])


if __name__ == "__main__":
    unittest.main()
