"""运行时适配器 — 桥接三种运行时到统一任务队列

Studio/Agent/Module 三种运行时各有不同的服务实例获取方式。
RuntimeAdapter 统一封装，让 task handler 无需关心底层差异。
"""
import logging
from typing import Any, Dict, Optional

from .runtime_config import (
    RuntimeRegistry,
    RuntimeType,
    RuntimeFeatureFlags,
    runtime_registry,
)
from .errors import normalize_error, get_display_message

logger = logging.getLogger(__name__)


class RuntimeAdapter:
    """运行时适配器 — 根据 runtime 字段分发服务调用

    task handler 通过 adapter 获取对应运行时的服务实例，
    不再直接依赖 deps 模块的全局变量。
    """

    def __init__(self, registry: RuntimeRegistry = None):
        self._registry = registry or runtime_registry

    # ------------------------------------------------------------------
    # 服务获取
    # ------------------------------------------------------------------

    def get_image_service(self, runtime: str) -> Any:
        """获取图片生成服务"""
        ref = self._registry.get_service_ref(runtime, "image_service")
        if ref:
            return ref
        # 延迟导入 deps 作为兜底
        return self._fallback_service(runtime, "image")

    def get_video_service(self, runtime: str) -> Any:
        """获取视频生成服务"""
        ref = self._registry.get_service_ref(runtime, "video_service")
        if ref:
            return ref
        return self._fallback_service(runtime, "video")

    def get_voice_service(self, runtime: str) -> Any:
        """获取语音合成服务"""
        ref = self._registry.get_service_ref(runtime, "voice_service")
        if ref:
            return ref
        return self._fallback_service(runtime, "voice")

    def get_llm_service(self, runtime: str) -> Any:
        """获取 LLM 服务"""
        ref = self._registry.get_service_ref(runtime, "llm_service")
        if ref:
            return ref
        return self._fallback_service(runtime, "llm")

    def get_storage(self, runtime: str) -> Any:
        """获取存储服务"""
        ref = self._registry.get_service_ref(runtime, "storage")
        if ref:
            return ref
        return self._fallback_service(runtime, "storage")

    def get_flags(self, runtime: str) -> RuntimeFeatureFlags:
        """获取运行时的 Feature Flags"""
        return self._registry.get_flags(runtime)

    # ------------------------------------------------------------------
    # 运行时判断
    # ------------------------------------------------------------------

    def should_use_task_queue(self, runtime: str) -> bool:
        return self.get_flags(runtime).use_task_queue

    def should_use_graph_executor(self, runtime: str) -> bool:
        return self.get_flags(runtime).use_graph_executor

    def should_use_watchdog(self, runtime: str) -> bool:
        return self.get_flags(runtime).use_watchdog

    def should_use_event_bus(self, runtime: str) -> bool:
        return self.get_flags(runtime).use_event_bus

    # ------------------------------------------------------------------
    # 错误处理
    # ------------------------------------------------------------------

    def handle_error(self, exc: Exception, runtime: str) -> Dict[str, Any]:
        """统一错误处理 — 推断错误码并返回结构化错误信息"""
        flags = self.get_flags(runtime)
        if flags.use_error_normalize:
            normalized = normalize_error(exc)
            return {
                "error_code": normalized.code,
                "http_status": normalized.entry.http_status,
                "retryable": normalized.entry.retryable,
                "message": get_display_message(normalized.code),
                "detail": str(exc),
                "runtime": runtime,
            }
        # 退化为简单错误
        return {
            "error_code": "INTERNAL_ERROR",
            "http_status": 500,
            "retryable": False,
            "message": str(exc),
            "runtime": runtime,
        }

    # ------------------------------------------------------------------
    # 兜底服务获取
    # ------------------------------------------------------------------

    def _fallback_service(self, runtime: str, service_type: str) -> Any:
        """通过 deps 模块获取服务实例 (兜底)"""
        try:
            import dependencies as deps

            if runtime == RuntimeType.STUDIO.value:
                return self._get_studio_service(deps, service_type)
            elif runtime == RuntimeType.AGENT.value:
                return self._get_agent_service(deps, service_type)
            elif runtime == RuntimeType.MODULE.value:
                return self._get_module_service(deps, service_type)
        except Exception as e:
            logger.warning(f"Failed to get fallback {service_type} for runtime {runtime}: {e}")
        return None

    @staticmethod
    def _get_studio_service(deps, service_type: str) -> Any:
        if service_type == "image":
            return getattr(deps, "module_image_service", None) or deps.get_module_image_service()
        elif service_type == "video":
            return getattr(deps, "module_video_service", None) or deps.get_module_video_service()
        elif service_type == "llm":
            return getattr(deps, "module_llm_service", None) or deps.get_module_llm_service()
        elif service_type == "storage":
            return getattr(deps, "studio_storage", None)
        elif service_type == "voice":
            return None  # TTS 通过 studio_service 内部管理
        return None

    @staticmethod
    def _get_agent_service(deps, service_type: str) -> Any:
        if service_type == "image":
            return getattr(deps, "image_service", None)
        elif service_type == "video":
            return getattr(deps, "video_service", None)
        elif service_type == "llm":
            return getattr(deps, "llm_service", None)
        elif service_type == "storage":
            return getattr(deps, "studio_storage", None)
        return None

    @staticmethod
    def _get_module_service(deps, service_type: str) -> Any:
        if service_type == "image":
            return getattr(deps, "module_image_service", None) or deps.get_module_image_service()
        elif service_type == "video":
            return getattr(deps, "module_video_service", None) or deps.get_module_video_service()
        elif service_type == "llm":
            return getattr(deps, "module_llm_service", None) or deps.get_module_llm_service()
        elif service_type == "storage":
            return getattr(deps, "studio_storage", None)
        return None


# 全局单例
runtime_adapter = RuntimeAdapter()
