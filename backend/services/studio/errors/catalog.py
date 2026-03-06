"""统一错误码目录"""
from enum import Enum
from dataclasses import dataclass


class ErrorCategory(str, Enum):
    PROVIDER = "provider"
    CONTENT = "content"
    SYSTEM = "system"
    VALIDATION = "validation"
    AUTH = "auth"


@dataclass(frozen=True)
class ErrorEntry:
    code: str
    http_status: int
    retryable: bool
    category: ErrorCategory
    message_zh: str


ERROR_CATALOG: dict[str, ErrorEntry] = {
    "RATE_LIMIT": ErrorEntry(
        code="RATE_LIMIT",
        http_status=429,
        retryable=True,
        category=ErrorCategory.PROVIDER,
        message_zh="请求频率超限，请稍后重试",
    ),
    "EXTERNAL_ERROR": ErrorEntry(
        code="EXTERNAL_ERROR",
        http_status=502,
        retryable=True,
        category=ErrorCategory.PROVIDER,
        message_zh="外部服务异常，请稍后重试",
    ),
    "NETWORK_ERROR": ErrorEntry(
        code="NETWORK_ERROR",
        http_status=502,
        retryable=True,
        category=ErrorCategory.PROVIDER,
        message_zh="网络连接异常",
    ),
    "GENERATION_TIMEOUT": ErrorEntry(
        code="GENERATION_TIMEOUT",
        http_status=504,
        retryable=True,
        category=ErrorCategory.PROVIDER,
        message_zh="生成超时，系统将自动重试",
    ),
    "GENERATION_FAILED": ErrorEntry(
        code="GENERATION_FAILED",
        http_status=500,
        retryable=True,
        category=ErrorCategory.PROVIDER,
        message_zh="生成失败，系统将自动重试",
    ),
    "SENSITIVE_CONTENT": ErrorEntry(
        code="SENSITIVE_CONTENT",
        http_status=422,
        retryable=False,
        category=ErrorCategory.CONTENT,
        message_zh="内容包含敏感信息，请修改后重试",
    ),
    "WATCHDOG_TIMEOUT": ErrorEntry(
        code="WATCHDOG_TIMEOUT",
        http_status=500,
        retryable=True,
        category=ErrorCategory.SYSTEM,
        message_zh="任务心跳超时，系统将自动重试",
    ),
    "INTERNAL_ERROR": ErrorEntry(
        code="INTERNAL_ERROR",
        http_status=500,
        retryable=False,
        category=ErrorCategory.SYSTEM,
        message_zh="内部错误",
    ),
    "INVALID_PARAMS": ErrorEntry(
        code="INVALID_PARAMS",
        http_status=400,
        retryable=False,
        category=ErrorCategory.VALIDATION,
        message_zh="参数错误",
    ),
    "MISSING_CONFIG": ErrorEntry(
        code="MISSING_CONFIG",
        http_status=422,
        retryable=False,
        category=ErrorCategory.VALIDATION,
        message_zh="缺少必要配置",
    ),
    "UNAUTHORIZED": ErrorEntry(
        code="UNAUTHORIZED",
        http_status=401,
        retryable=False,
        category=ErrorCategory.AUTH,
        message_zh="未授权，请检查认证信息",
    ),
}
