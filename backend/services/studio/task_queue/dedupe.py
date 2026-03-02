"""任务去重守卫 — dedupe_key 生成与冲突检测

移植 waoowaoo 的去重逻辑:
- 根据 (type, target_type, target_id, episode_id) 生成 dedupe_key
- 提交前检查活跃任务是否已存在相同 key
- 结合 arq job 存活检测判定真重复 vs 孤儿
"""
import hashlib
import logging
from dataclasses import dataclass
from typing import Optional

from .storage import TaskStorage
from .types import TaskJobData, CreateTaskInput

logger = logging.getLogger(__name__)


@dataclass
class DedupeResult:
    """去重检测结果"""
    is_duplicate: bool
    existing_task: Optional[TaskJobData] = None
    orphan_recycled: bool = False


def build_dedupe_key(inp: CreateTaskInput) -> str:
    """根据任务属性生成去重键。

    格式: dedupe:{type}:{target_type}:{target_id}:{episode_id}
    如果调用方已提供 dedupe_key 则直接使用。
    """
    if inp.dedupe_key:
        return inp.dedupe_key

    raw = f"{inp.type}:{inp.target_type}:{inp.target_id}:{inp.episode_id}"
    digest = hashlib.sha256(raw.encode()).hexdigest()[:16]
    return f"dedupe:{inp.type}:{inp.target_type}:{digest}"


def check_dedupe(
    storage: TaskStorage,
    dedupe_key: str,
) -> DedupeResult:
    """同步去重检查 — 只查 SQLite。

    返回 DedupeResult:
    - is_duplicate=True  表示存在相同 key 的活跃任务
    - is_duplicate=False 表示无冲突，可正常创建
    """
    if not dedupe_key:
        return DedupeResult(is_duplicate=False)

    existing = storage.find_by_dedupe_key(dedupe_key)
    if existing:
        return DedupeResult(is_duplicate=True, existing_task=existing)

    return DedupeResult(is_duplicate=False)


async def check_dedupe_with_arq(
    storage: TaskStorage,
    dedupe_key: str,
    queue_manager=None,
) -> DedupeResult:
    """异步去重检查 — SQLite + arq job 存活验证。

    当 SQLite 中存在活跃任务时，进一步检查 arq job 是否仍在:
    - job 存在 -> 真重复，返回已有任务
    - job 不存在 -> 孤儿，标记失败后返回 is_duplicate=False
    """
    if not dedupe_key:
        return DedupeResult(is_duplicate=False)

    existing = storage.find_by_dedupe_key(dedupe_key)
    if not existing:
        return DedupeResult(is_duplicate=False)

    # 有活跃任务 — 验证 arq job
    if queue_manager:
        alive = await _is_arq_job_alive(existing.id, queue_manager)
        if alive:
            logger.info(f"Dedupe hit: task {existing.id} (key={dedupe_key}) still alive in arq")
            return DedupeResult(is_duplicate=True, existing_task=existing)
        else:
            # 孤儿任务 — 回收
            storage.try_mark_failed(existing.id, "ORPHANED", "去重检测发现孤儿任务，已回收")
            logger.warning(f"Orphan task recycled during dedupe: {existing.id} (key={dedupe_key})")
            return DedupeResult(is_duplicate=False, orphan_recycled=True)

    # 无 queue_manager (studio 内存模式) — 信任 SQLite 状态
    logger.info(f"Dedupe hit (no arq): task {existing.id} (key={dedupe_key})")
    return DedupeResult(is_duplicate=True, existing_task=existing)


async def _is_arq_job_alive(job_id: str, queue_manager) -> bool:
    """检查 arq job 是否仍在队列 / 正在执行"""
    try:
        from arq.jobs import Job, JobStatus
        job = Job(job_id, queue_manager.pool)
        info = await job.info()
        if info is None:
            return False
        return info.status in (JobStatus.queued, JobStatus.in_progress, JobStatus.deferred)
    except Exception as e:
        logger.warning(f"Failed to check arq job {job_id}: {e}")
        return False
