# -*- coding: utf-8 -*-
"""只从服务端已观察的业务回合 usage 汇总；缺失字段不能推成零成本。"""
from __future__ import annotations
import math


def wilson_interval(successes: int, total: int, z: float = 1.96) -> tuple[float, float] | None:
    """二项比例的 Wilson 95% 区间；样本为空时返回 None。"""
    if total <= 0 or successes < 0 or successes > total:
        return None
    p = successes / total
    denominator = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denominator
    margin = z * math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator
    return (max(0.0, center - margin), min(1.0, center + margin))


def _numeric(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def _percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * fraction) - 1)]


def _tool_metrics(events: list[dict]) -> dict[str, dict]:
    grouped: dict[str, list[dict]] = {}
    for event in events:
        if event.get('type') != 'tool.telemetry':
            continue
        payload = event.get('payload', {})
        if payload.get('phase', 'finish') != 'finish':
            continue
        tool = payload.get('tool')
        elapsed = payload.get('elapsed_ms')
        if not isinstance(tool, str) or not tool or not _numeric(elapsed):
            continue
        grouped.setdefault(tool, []).append(payload)
    result = {}
    for tool, rows in sorted(grouped.items()):
        elapsed = [float(row['elapsed_ms']) for row in rows]
        errors = sum(row.get('status') != 'success' for row in rows)
        input_tokens = [row.get('input_tokens') for row in rows]
        output_tokens = [row.get('output_tokens') for row in rows]
        input_complete = all(type(value) is int and value >= 0 for value in input_tokens)
        output_complete = all(type(value) is int and value >= 0 for value in output_tokens)
        result[tool] = {
            'calls': len(rows),
            'errors': errors,
            'error_rate': errors / len(rows),
            'p50_ms': _percentile(elapsed, .50),
            'p95_ms': _percentile(elapsed, .95),
            'input_tokens': sum(input_tokens) if input_complete else None,
            'output_tokens': sum(output_tokens) if output_complete else None,
            'usage_complete': input_complete and output_complete,
        }
    return result


def collect_case_metrics(events: list[dict], *, expected_turns: int, elapsed_ms: float) -> dict:
    summaries = [event.get('payload', {}) for event in events if event.get('type') == 'usage.summary']
    complete = len(summaries) == expected_turns and all(row.get('usage_complete') is True and
        all(type(row.get(key)) is int and row[key] >= 0 for key in ('input_tokens', 'output_tokens')) for row in summaries)
    cost_complete = len(summaries) == expected_turns and all(_numeric(row.get('cost_usd')) for row in summaries)
    cache_events = [event.get('payload', {}) for event in events if event.get('type') == 'cache.lookup']
    cache_hits = sum(row.get('outcome') == 'hit' for row in cache_events)
    cache_misses = sum(row.get('outcome') == 'miss' for row in cache_events)
    cache_bypasses = sum(isinstance(row.get('outcome'), str) and row.get('outcome', '').startswith('bypass_') for row in cache_events)
    return {'elapsed_ms': elapsed_ms, 'latency_scope': 'agent_dialogue_and_http_actions_excluding_judge',
            'input_tokens': sum(row['input_tokens'] for row in summaries) if complete else None,
            'output_tokens': sum(row['output_tokens'] for row in summaries) if complete else None,
            'cost_usd': sum(row['cost_usd'] for row in summaries) if cost_complete else None,
            'usage_complete': complete, 'observed_turns': len(summaries), 'expected_turns': expected_turns,
            'cost_source': 'configured_price_table' if cost_complete else 'unknown',
            'cache_hits': cache_hits, 'cache_misses': cache_misses, 'cache_bypasses': cache_bypasses,
            'cache_eligible_lookups': cache_hits + cache_misses,
            'cache_hit_rate': cache_hits / (cache_hits + cache_misses) if cache_hits + cache_misses else None,
            'tool_metrics': _tool_metrics(events)}


def release_metrics(results: list[dict]) -> dict:
    count = len(results)
    metrics = [result.get('metrics', {}) for result in results]
    latency_complete = bool(results) and all(_numeric(row.get('elapsed_ms')) for row in metrics)
    usage_complete = bool(results) and all(row.get('usage_complete') is True for row in metrics)
    elapsed = sorted(row['elapsed_ms'] for row in metrics) if latency_complete else []
    successes = sum(result.get('verdict') == 'PASS' for result in results)
    hard_constraint_passes = sum(result.get('p0_pass') is True for result in results)
    cache_hits = sum(int(row.get('cache_hits', 0) or 0) for row in metrics)
    cache_misses = sum(int(row.get('cache_misses', 0) or 0) for row in metrics)
    cache_eligible = cache_hits + cache_misses
    return {'task_success_rate': successes / count if count else None,
            'task_success_rate_ci95': wilson_interval(successes, count),
            'hard_constraint_pass_rate': hard_constraint_passes / count if count else None,
            'hard_constraint_pass_rate_ci95': wilson_interval(hard_constraint_passes, count),
            'latency_p95_ms': elapsed[max(0, math.ceil(count * .95)-1)] if latency_complete else None,
            'input_tokens': sum(row['input_tokens'] for row in metrics) if usage_complete else None,
            'output_tokens': sum(row['output_tokens'] for row in metrics) if usage_complete else None,
            'cost_usd': sum(row['cost_usd'] for row in metrics) if count and all(_numeric(row.get('cost_usd')) for row in metrics) else None,
            'cache_hits': cache_hits, 'cache_misses': cache_misses,
            'cache_eligible_lookups': cache_eligible,
            'cache_hit_rate': cache_hits / cache_eligible if cache_eligible else None,
            'scope': 'full_selected_cases; latency_excludes_judge; hard_constraint=P0_all_pass',
            'usage_complete': usage_complete}
