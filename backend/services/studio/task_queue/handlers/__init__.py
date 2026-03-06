"""任务处理器注册表"""
from typing import Callable, Dict
from ..types import TaskJobData

# handler 注册表: task_type -> handler function
_HANDLERS: Dict[str, Callable] = {}


def register_handler(task_type: str):
    """装饰器: 注册任务处理器"""
    def decorator(fn):
        _HANDLERS[task_type] = fn
        return fn
    return decorator


def get_handler(task_type: str) -> Callable:
    handler = _HANDLERS.get(task_type)
    if not handler:
        raise ValueError(f"No handler registered for task type: {task_type}")
    return handler


# 导入各处理器模块以触发注册
from . import image_handlers, video_handlers, voice_handlers, text_handlers, pipeline_handlers
