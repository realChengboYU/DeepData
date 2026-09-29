"""数据源凭据加密：密码用服务端密钥 AES-GCM 加密后落库，避免明文进库。
- 密钥从环境变量 ``DS_CREDENTIAL_KEY`` 读取（32 字节的 base64 或 64 位 hex）。
- 未配置 / 格式不符时回退到「开发默认密钥」并告警（生产务必配置 DS_CREDENTIAL_KEY）。
- 落库格式：``enc1:<urlsafe-base64(nonce‖ciphertext)>``。
- 向后兼容：``decrypt`` 对不带 ``enc1:`` 前缀的值（历史明文）原样返回。
"""

from __future__ import annotations

import base64
import hashlib
import os
import secrets
import warnings

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_TAG = "enc1:"
_NONCE = 12

_key_cache: bytes | None = None
_warned = False


def _key() -> bytes:
    """解析 32 字节服务端密钥（进程内缓存；只告警一次）。"""
    global _key_cache, _warned
    if _key_cache is not None:
        return _key_cache

    raw = os.getenv("DS_CREDENTIAL_KEY", "").strip()
    found: bytes | None = None
    if raw:
        for decode in (base64.b64decode, lambda s: bytes.fromhex(s)):
            try:
                cand = decode(raw)
            except Exception:
                continue
            if isinstance(cand, (bytes, bytearray)) and len(cand) == 32:
                found = bytes(cand)
                break

    if found is None:
        if not _warned:
            warnings.warn(
                "未配置 DS_CREDENTIAL_KEY（或不是 32 字节 base64/hex）；"
                "已回退到开发默认密钥。生产环境请配置 32 字节的 base64 密钥。",
                stacklevel=2,
            )
            _warned = True
        found = hashlib.sha256(b"deepdata-dev-credential-key-v1").digest()

    _key_cache = found
    return found


def encrypt(plaintext: str | None) -> str:
    """把明文密码加密成落库 token；空值返回空串。"""
    if plaintext is None:
        return ""
    data = str(plaintext).encode("utf-8")
    nonce = secrets.token_bytes(_NONCE)
    ct = AESGCM(_key()).encrypt(nonce, data, None)
    return _TAG + base64.urlsafe_b64encode(nonce + ct).decode("ascii")


def decrypt(stored: str | None) -> str:
    """把落库 token 解密回明文；历史明文（无 enc1: 前缀）原样返回。"""
    s = "" if stored is None else str(stored)
    if not s.startswith(_TAG):
        return s
    try:
        raw = base64.urlsafe_b64decode(s[len(_TAG):].encode("ascii"))
        nonce, ct = raw[:_NONCE], raw[_NONCE:]
        return AESGCM(_key()).decrypt(nonce, ct, None).decode("utf-8")
    except Exception:
        # 密钥不匹配 / 数据损坏：退回原值，宁可报错也不静默丢凭据
        return s
