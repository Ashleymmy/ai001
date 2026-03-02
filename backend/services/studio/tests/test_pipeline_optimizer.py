"""Tests for pipeline_optimizer.py — 12 tests (mixed async)."""
import asyncio
import time

import pytest

from backend.services.studio.pipeline_optimizer import (
    RhythmTemplate,
    RHYTHM_TEMPLATES,
    get_rhythm_template,
    list_rhythm_templates,
    adapt_pipeline_for_short_video,
    auto_match_lip_sync_style,
    KBCache,
    get_shared_kb_cache,
    run_parallel_stages,
    AsyncQARunner,
    PARALLEL_STAGE_GROUPS,
)


def test_rhythm_templates_count_5():
    assert len(RHYTHM_TEMPLATES) == 5
    expected = {"fast_cut", "slow_narrative", "climax_build", "douyin_hook", "xiaohongshu_aesthetic"}
    assert set(RHYTHM_TEMPLATES.keys()) == expected


def test_get_rhythm_template_known():
    tmpl = get_rhythm_template("fast_cut")
    assert tmpl is not None
    assert isinstance(tmpl, RhythmTemplate)
    assert tmpl.name_en == "Fast Cut"
    assert tmpl.platform == "universal"
    assert len(tmpl.segments) == 4


def test_get_rhythm_template_unknown():
    assert get_rhythm_template("nonexistent") is None


def test_list_rhythm_templates_all():
    templates = list_rhythm_templates()
    assert len(templates) == 5
    for t in templates:
        assert "template_id" in t
        assert "total_shots" in t


def test_list_rhythm_templates_filter_douyin():
    templates = list_rhythm_templates(platform="douyin")
    # Should include douyin-specific and universal templates
    ids = {t["template_id"] for t in templates}
    assert "douyin_hook" in ids
    assert "fast_cut" in ids  # universal
    assert "xiaohongshu_aesthetic" not in ids


def test_adapt_pipeline_short_video():
    pipeline_state = {"series_id": "s1", "shots": []}
    adapted = adapt_pipeline_for_short_video(pipeline_state, "fast_cut")
    assert adapted["rhythm_template_id"] == "fast_cut"
    assert adapted["total_duration"] == 60
    assert adapted["platform"] == "universal"
    assert len(adapted["adapted_shots"]) == 19  # 2+8+6+3
    # Original should not be mutated
    assert "rhythm_template_id" not in pipeline_state


def test_kb_cache_set_get():
    cache = KBCache(max_size=10, ttl_seconds=60)
    cache.set("key1", "value1")
    assert cache.get("key1") == "value1"
    assert cache.get("missing") is None


def test_kb_cache_ttl_expiry():
    cache = KBCache(max_size=10, ttl_seconds=0)  # 0-second TTL → instant expiry
    cache.set("key1", "value1")
    time.sleep(0.01)
    assert cache.get("key1") is None


def test_kb_cache_eviction():
    cache = KBCache(max_size=3, ttl_seconds=60)
    cache.set("a", 1)
    cache.set("b", 2)
    cache.set("c", 3)
    # Cache is full, adding "d" should evict the oldest
    cache.set("d", 4)
    stats = cache.stats()
    assert stats["size"] == 3
    assert cache.get("d") == 4


def test_kb_cache_stats():
    cache = KBCache(max_size=10, ttl_seconds=60)
    cache.set("x", 1)
    cache.get("x")  # hit
    cache.get("y")  # miss
    stats = cache.stats()
    assert stats["hits"] == 1
    assert stats["misses"] == 1
    assert stats["size"] == 1
    assert stats["hit_rate"] == 0.5


@pytest.mark.asyncio
async def test_async_qa_runner_submit_and_get():
    runner = AsyncQARunner()

    async def dummy_check(x):
        return {"passed": True, "value": x}

    check_id = await runner.submit_check("check_1", dummy_check, 42)
    assert check_id == "check_1"
    result = await runner.get_result("check_1", timeout=5.0)
    assert result is not None
    assert result["status"] == "completed"
    assert result["result"]["value"] == 42
    assert runner.pending_count() == 0


@pytest.mark.asyncio
async def test_run_parallel_stages():
    results_order = []

    async def stage_a():
        await asyncio.sleep(0.01)
        results_order.append("a")
        return "A"

    async def stage_b():
        results_order.append("b")
        return "B"

    results = await run_parallel_stages([stage_a, stage_b], max_concurrency=2)
    assert results == ["A", "B"]
    assert len(results_order) == 2
