"""异常 → 统一错误码 推断"""
import asyncio
import re
from dataclasses import dataclass
from typing import Optional

from .catalog import ERROR_CATALOG, ErrorEntry


@dataclass
class NormalizedError:
    code: str
    entry: ErrorEntry
    original: Optional[Exception] = None


_STATUS_MAP: dict[int, str] = {
    429: "RATE_LIMIT",
    401: "UNAUTHORIZED",
    400: "INVALID_PARAMS",
    422: "SENSITIVE_CONTENT",
    502: "EXTERNAL_ERROR",
    503: "EXTERNAL_ERROR",
    504: "GENERATION_TIMEOUT",
}

_KEYWORD_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"超时|timeout", re.IGNORECASE), "GENERATION_TIMEOUT"),
    (re.compile(r"敏感|sensitive|content.?filter", re.IGNORECASE), "SENSITIVE_CONTENT"),
    (re.compile(r"频率限制|rate.?limit|too.?many", re.IGNORECASE), "RATE_LIMIT"),
    (re.compile(r"余额不足|insufficient", re.IGNORECASE), "RATE_LIMIT"),
    (re.compile(r"unauthorized|未授权", re.IGNORECASE), "UNAUTHORIZED"),
]


def normalize_error(exc: Exception) -> NormalizedError:
    """将任意异常推断为统一错误码。"""

    # 1. isinstance 检查
    if isinstance(exc, (TimeoutError, asyncio.TimeoutError)):
        code = "GENERATION_TIMEOUT"
        return NormalizedError(code=code, entry=ERROR_CATALOG[code], original=exc)
    if isinstance(exc, PermissionError):
        code = "UNAUTHORIZED"
        return NormalizedError(code=code, entry=ERROR_CATALOG[code], original=exc)
    if isinstance(exc, (ConnectionError, OSError)):
        code = "NETWORK_ERROR"
        return NormalizedError(code=code, entry=ERROR_CATALOG[code], original=exc)
    if isinstance(exc, ValueError):
        code = "INVALID_PARAMS"
        return NormalizedError(code=code, entry=ERROR_CATALOG[code], original=exc)

    # 2. hasattr(exc, 'code') — 直接查目录
    exc_code = getattr(exc, "code", None)
    if exc_code and exc_code in ERROR_CATALOG:
        return NormalizedError(
            code=exc_code, entry=ERROR_CATALOG[exc_code], original=exc
        )

    # 3. hasattr(exc, 'status_code') — 按 HTTP status 映射
    status_code = getattr(exc, "status_code", None)
    if status_code and status_code in _STATUS_MAP:
        code = _STATUS_MAP[status_code]
        return NormalizedError(code=code, entry=ERROR_CATALOG[code], original=exc)

    # 4. 消息关键字匹配
    msg = str(exc)
    for pattern, code in _KEYWORD_PATTERNS:
        if pattern.search(msg):
            return NormalizedError(code=code, entry=ERROR_CATALOG[code], original=exc)

    # 5. 兜底
    code = "INTERNAL_ERROR"
    return NormalizedError(code=code, entry=ERROR_CATALOG[code], original=exc)
