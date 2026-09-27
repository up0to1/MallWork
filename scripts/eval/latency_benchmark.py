# -*- coding: utf-8 -*-
"""离线 serial/parallel 延迟对比。

该模块只读取已经保存的 JSON/JSONL 结果，不启动服务、不调用模型，适合每次开发
阶段的零成本验证。真实 benchmark 只负责产出同样的样本格式，分析逻辑保持一致。
"""
from __future__ import annotations

import json
import math
import argparse
from pathlib import Path
from typing import Any, Iterable


def _percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(len(ordered) * fraction) - 1))
    return round(ordered[index], 3)


def _valid_rows(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("case_id"), str):
            raise ValueError("每条延迟样本都需要字符串 case_id")
        elapsed = row.get("elapsed_ms")
        if type(elapsed) not in (int, float) or not math.isfinite(elapsed) or elapsed < 0:
            raise ValueError("每条延迟样本都需要非负 elapsed_ms")
        result.append(row)
    return result


def summarize_samples(rows: Iterable[dict[str, Any]]) -> dict[str, Any]:
    samples = _valid_rows(rows)
    elapsed = [float(row["elapsed_ms"]) for row in samples]
    passed = sum(row.get("verdict") == "PASS" for row in samples)
    return {
        "count": len(samples),
        "p50_ms": _percentile(elapsed, 0.50),
        "p95_ms": _percentile(elapsed, 0.95),
        "mean_ms": round(sum(elapsed) / len(elapsed), 3) if elapsed else None,
        "successes": passed,
        "success_rate": passed / len(samples) if samples else None,
    }


def compare_modes(serial_rows: Iterable[dict[str, Any]], parallel_rows: Iterable[dict[str, Any]]) -> dict[str, Any]:
    serial = _valid_rows(serial_rows)
    parallel = _valid_rows(parallel_rows)
    serial_by_id = {row["case_id"]: row for row in serial}
    parallel_by_id = {row["case_id"]: row for row in parallel}
    if set(serial_by_id) != set(parallel_by_id):
        raise ValueError("serial 与 parallel 的 case_id 集合必须一致")

    paired = []
    for case_id in sorted(serial_by_id):
        baseline = float(serial_by_id[case_id]["elapsed_ms"])
        candidate = float(parallel_by_id[case_id]["elapsed_ms"])
        paired.append((baseline - candidate) / baseline if baseline > 0 else 0.0)

    serial_summary = summarize_samples(serial)
    parallel_summary = summarize_samples(parallel)
    serial_p50, parallel_p50 = serial_summary["p50_ms"], parallel_summary["p50_ms"]
    serial_p95, parallel_p95 = serial_summary["p95_ms"], parallel_summary["p95_ms"]
    return {
        "paired_cases": len(paired),
        "serial": serial_summary,
        "parallel": parallel_summary,
        "p50_reduction": (serial_p50 - parallel_p50) / serial_p50 if serial_p50 else None,
        "p95_reduction": (serial_p95 - parallel_p95) / serial_p95 if serial_p95 else None,
        "paired_mean_reduction": sum(paired) / len(paired) if paired else None,
        "success_rate_delta": (parallel_summary["success_rate"] - serial_summary["success_rate"])
        if serial_summary["success_rate"] is not None and parallel_summary["success_rate"] is not None else None,
    }


def load_jsonl(path: str | Path) -> list[dict[str, Any]]:
    """读取离线样本；不执行任何外部调用。"""
    rows = []
    for line_number, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as error:
            raise ValueError(f"第 {line_number} 行不是合法 JSON") from error
        rows.append(value)
    return rows


def main(argv: list[str] | None = None) -> int:
    """离线命令行入口；没有 --live 选项，也不会创建任何模型请求。"""
    parser = argparse.ArgumentParser(description="离线比较串行与并行复杂任务延迟")
    parser.add_argument("--serial", required=True, help="串行结果 JSONL")
    parser.add_argument("--parallel", required=True, help="并行结果 JSONL")
    parser.add_argument("--output", help="可选输出 JSON 文件")
    args = parser.parse_args(argv)
    result = compare_modes(load_jsonl(args.serial), load_jsonl(args.parallel))
    encoded = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        Path(args.output).write_text(encoded, encoding="utf-8")
    else:
        print(encoded, end="")
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI thin wrapper
    raise SystemExit(main())
