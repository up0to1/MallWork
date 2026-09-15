# -*- coding: utf-8 -*-
from app.infrastructure.cache.telemetry import CacheMetricsRegistry


def test_cache_metrics_only_count_hit_rate_over_eligible_lookups():
    registry = CacheMetricsRegistry(window_size=10)
    registry.observe("miss", latency_ms=18)
    registry.observe("hit", latency_ms=3, saved_input_tokens=120, saved_output_tokens=40)
    registry.observe("bypass_history", latency_ms=1)

    summary = registry.snapshot()

    assert summary["eligible_lookups"] == 2
    assert summary["hits"] == 1
    assert summary["misses"] == 1
    assert summary["hit_rate"] == 0.5
    assert summary["bypasses"] == 1
    assert summary["saved_input_tokens"] == 120
    assert summary["saved_output_tokens"] == 40


def test_cache_metrics_reject_unknown_outcome():
    registry = CacheMetricsRegistry()
    registry.observe("not-a-real-outcome", latency_ms=1)
    assert registry.snapshot()["total_events"] == 0
