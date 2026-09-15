# -*- coding: utf-8 -*-
"""语义缓存的低基数遥测聚合。

这里只保存固定 outcome、耗时和 Token 数，不保存 query、买家标识或回复正文。
命中率的分母只包含真正进入缓存查找的 hit/miss，不把历史上下文、写操作等 bypass
请求混进来，避免产生误导性的缓存命中率。
"""
from __future__ import annotations

from collections import Counter, deque
import math
from threading import Lock
from typing import Any

CACHE_OUTCOMES = frozenset({
    "hit", "miss", "bypass_history", "bypass_unsafe", "bypass_policy", "disabled", "error",
})
def _non_negative_number(value: Any) -> bool:
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


class CacheMetricsRegistry:
    """进程内滚动缓存指标；跨 worker 时由外部采集端按事件聚合。"""

    def __init__(self, window_size: int = 1000) -> None:
        self._lock = Lock()
        self._counts: Counter[str] = Counter()
        self._latencies: deque[float] = deque(maxlen=window_size)
        self._saved_input_tokens = 0
        self._saved_output_tokens = 0

    def observe(
        self,
        outcome: str,
        *,
        latency_ms: float | None = None,
        saved_input_tokens: int = 0,
        saved_output_tokens: int = 0,
    ) -> None:
        if outcome not in CACHE_OUTCOMES:
            return
        with self._lock:
            self._counts[outcome] += 1
            if _non_negative_number(latency_ms):
                self._latencies.append(float(latency_ms))
            if type(saved_input_tokens) is int and saved_input_tokens >= 0:
                self._saved_input_tokens += saved_input_tokens
            if type(saved_output_tokens) is int and saved_output_tokens >= 0:
                self._saved_output_tokens += saved_output_tokens

    @staticmethod
    def _percentile(values: list[float], fraction: float) -> float | None:
        if not values:
            return None
        ordered = sorted(values)
        index = max(0, min(len(ordered) - 1, int((len(ordered) * fraction + 0.999999) - 1)))
        return round(ordered[index], 3)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            counts = dict(self._counts)
            latencies = list(self._latencies)
            hits = counts.get("hit", 0)
            misses = counts.get("miss", 0)
            eligible = hits + misses
            total = sum(counts.values())
            return {
                "scope": "process_local_cache_lookups",
                "total_events": total,
                "eligible_lookups": eligible,
                "hits": hits,
                "misses": misses,
                "bypasses": sum(counts.get(key, 0) for key in CACHE_OUTCOMES if key.startswith("bypass_")),
                "hit_rate": hits / eligible if eligible else None,
                "saved_input_tokens": self._saved_input_tokens,
                "saved_output_tokens": self._saved_output_tokens,
                "lookup_latency_p50_ms": self._percentile(latencies, 0.50),
                "lookup_latency_p95_ms": self._percentile(latencies, 0.95),
                "outcomes": {key: counts.get(key, 0) for key in sorted(CACHE_OUTCOMES)},
            }


registry = CacheMetricsRegistry()
