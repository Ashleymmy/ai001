"""运行时配置与 Feature Flags

三种运行时:
- studio: Studio 工作台 (StudioService + batch_generate)
- agent:  Agent 多角色管线 (AgentPipeline + AgentService)
- module: 独立模块 (Module 级别服务实例)

Feature Flags 控制各运行时的新管线是否启用。
"""
import os
import json
import logging
from dataclasses import dataclass, field, asdict
from typing import Dict, Any, Optional
from enum import Enum

logger = logging.getLogger(__name__)


class RuntimeType(str, Enum):
    STUDIO = "studio"
    AGENT = "agent"
    MODULE = "module"


@dataclass
class RuntimeFeatureFlags:
    """每个运行时的 Feature Flags"""
    use_task_queue: bool = False        # 是否使用新的 arq 任务队列
    use_graph_executor: bool = False    # 是否使用图执行器管线
    use_error_normalize: bool = True    # 是否使用统一错误推断
    use_watchdog: bool = False          # 是否启用心跳看门狗
    use_event_bus: bool = False         # 是否启用事件总线
    max_concurrent_images: int = 3      # 图片最大并发
    max_concurrent_videos: int = 2      # 视频最大并发
    max_concurrent_voice: int = 2       # 语音最大并发
    max_concurrent_text: int = 4        # 文本最大并发
    retry_enabled: bool = True          # 是否启用重试
    max_retries: int = 3               # 最大重试次数


# 默认 Feature Flags (渐进式开关: studio 优先启用)
_DEFAULT_FLAGS: Dict[str, RuntimeFeatureFlags] = {
    RuntimeType.STUDIO.value: RuntimeFeatureFlags(
        use_task_queue=True,
        use_graph_executor=True,
        use_error_normalize=True,
        use_watchdog=True,
        use_event_bus=True,
    ),
    RuntimeType.AGENT.value: RuntimeFeatureFlags(
        use_task_queue=False,
        use_graph_executor=False,
        use_error_normalize=True,
        use_watchdog=False,
        use_event_bus=False,
    ),
    RuntimeType.MODULE.value: RuntimeFeatureFlags(
        use_task_queue=False,
        use_graph_executor=False,
        use_error_normalize=True,
        use_watchdog=False,
        use_event_bus=False,
    ),
}


@dataclass
class RuntimeDescriptor:
    """运行时描述符 — 注册每个运行时的服务获取方式"""
    runtime: str
    display_name: str
    flags: RuntimeFeatureFlags = field(default_factory=RuntimeFeatureFlags)
    service_refs: Dict[str, Any] = field(default_factory=dict)


class RuntimeRegistry:
    """运行时注册中心 — 管理三种运行时的配置和服务引用"""

    def __init__(self):
        self._runtimes: Dict[str, RuntimeDescriptor] = {}
        self._flags_overrides: Dict[str, Dict[str, Any]] = {}
        self._load_env_overrides()

    def register(
        self,
        runtime: str,
        display_name: str,
        flags: Optional[RuntimeFeatureFlags] = None,
        service_refs: Optional[Dict[str, Any]] = None,
    ) -> RuntimeDescriptor:
        """注册运行时"""
        default = _DEFAULT_FLAGS.get(runtime, RuntimeFeatureFlags())
        effective_flags = flags or default

        # 应用环境变量覆盖
        env_overrides = self._flags_overrides.get(runtime, {})
        for key, val in env_overrides.items():
            if hasattr(effective_flags, key):
                setattr(effective_flags, key, val)

        desc = RuntimeDescriptor(
            runtime=runtime,
            display_name=display_name,
            flags=effective_flags,
            service_refs=service_refs or {},
        )
        self._runtimes[runtime] = desc
        logger.info(f"Runtime registered: {runtime} ({display_name})")
        return desc

    def get(self, runtime: str) -> Optional[RuntimeDescriptor]:
        return self._runtimes.get(runtime)

    def get_flags(self, runtime: str) -> RuntimeFeatureFlags:
        desc = self._runtimes.get(runtime)
        if desc:
            return desc.flags
        return _DEFAULT_FLAGS.get(runtime, RuntimeFeatureFlags())

    def list_runtimes(self) -> list:
        return [
            {
                "runtime": d.runtime,
                "display_name": d.display_name,
                "flags": asdict(d.flags),
            }
            for d in self._runtimes.values()
        ]

    def update_flag(self, runtime: str, flag_name: str, value: Any) -> bool:
        """动态更新 Feature Flag"""
        desc = self._runtimes.get(runtime)
        if not desc:
            return False
        if not hasattr(desc.flags, flag_name):
            return False
        setattr(desc.flags, flag_name, value)
        logger.info(f"Runtime flag updated: {runtime}.{flag_name} = {value}")
        return True

    def update_service_ref(self, runtime: str, key: str, service: Any):
        """更新运行时的服务引用"""
        desc = self._runtimes.get(runtime)
        if desc:
            desc.service_refs[key] = service

    def get_service_ref(self, runtime: str, key: str) -> Any:
        desc = self._runtimes.get(runtime)
        if desc:
            return desc.service_refs.get(key)
        return None

    def _load_env_overrides(self):
        """从环境变量加载 Flag 覆盖

        格式: RUNTIME_FLAG_{RUNTIME}_{FLAG_NAME}=value
        例如: RUNTIME_FLAG_STUDIO_USE_TASK_QUEUE=true
        """
        prefix = "RUNTIME_FLAG_"
        for key, val in os.environ.items():
            if not key.startswith(prefix):
                continue
            parts = key[len(prefix):].lower().split("_", 1)
            if len(parts) != 2:
                continue
            runtime_key, flag_name = parts
            # 解析布尔值和整数
            parsed = _parse_env_value(val)
            if runtime_key not in self._flags_overrides:
                self._flags_overrides[runtime_key] = {}
            self._flags_overrides[runtime_key][flag_name] = parsed


def _parse_env_value(val: str) -> Any:
    """解析环境变量值为适当类型"""
    low = val.strip().lower()
    if low in ("true", "1", "yes", "on"):
        return True
    if low in ("false", "0", "no", "off"):
        return False
    try:
        return int(val)
    except ValueError:
        pass
    return val


# 全局单例
runtime_registry = RuntimeRegistry()


def init_runtimes():
    """初始化三个运行时 — 应在应用启动时调用"""
    runtime_registry.register(
        RuntimeType.STUDIO.value,
        "Studio 工作台",
    )
    runtime_registry.register(
        RuntimeType.AGENT.value,
        "Agent 多角色管线",
    )
    runtime_registry.register(
        RuntimeType.MODULE.value,
        "独立模块",
    )
    logger.info("All runtimes initialized")
