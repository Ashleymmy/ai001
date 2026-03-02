"""用户友好的中文错误消息"""
from typing import Optional

DISPLAY_MESSAGES: dict[str, str] = {
    "RATE_LIMIT": "请求频率超限，请稍后重试",
    "EXTERNAL_ERROR": "外部服务暂时不可用，请稍后重试",
    "NETWORK_ERROR": "网络连接异常，请检查网络后重试",
    "GENERATION_TIMEOUT": "生成超时，系统将自动重试",
    "GENERATION_FAILED": "生成失败，系统将自动重试",
    "SENSITIVE_CONTENT": "内容包含敏感信息，请修改后重试",
    "WATCHDOG_TIMEOUT": "任务处理超时，系统将自动重试",
    "INTERNAL_ERROR": "系统内部错误，请稍后重试",
    "INVALID_PARAMS": "请求参数错误，请检查输入",
    "MISSING_CONFIG": "缺少必要配置，请联系管理员",
    "UNAUTHORIZED": "未授权，请检查认证信息",
}


def get_display_message(code: str, default: Optional[str] = None) -> str:
    """根据错误码返回用户友好的中文消息。"""
    return DISPLAY_MESSAGES.get(code, default or "未知错误，请稍后重试")
