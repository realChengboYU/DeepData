# -*- coding: utf-8 -*-

from __future__ import annotations

import re
from typing import Iterable, List


# 英文 / 数字 / 下划线连续片段
_WORD_RE = re.compile(r"[a-zA-Z0-9_]+")
# 连续中文字符
_CN_RE = re.compile(r"[\u4e00-\u9fff]+")


def tokenize(text: str) -> List[str]:
    """把一段文本切成 BM25 词元，小写化，返回去空的词元列表。"""
    if not text:
        return []

    text = text.lower()
    tokens: List[str] = []

    # 1) 英文 / 数字 / 下划线连续词
    tokens.extend(_WORD_RE.findall(text))

    # 2) 中文：整段 + 单字 + bigram
    for span in _CN_RE.findall(text):
        tokens.append(span)
        tokens.extend(span)  # 单字
        for i in range(len(span) - 1):
            tokens.append(span[i : i + 2])  # bigram

    return [token for token in tokens if token.strip()]


def tokenize_many(texts: Iterable[str]) -> List[List[str]]:
    """批量分词。"""
    return [tokenize(text) for text in texts]
