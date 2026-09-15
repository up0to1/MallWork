# -*- coding: utf-8 -*-
import pytest

from scripts.eval.latency_benchmark import compare_modes, summarize_samples


def test_latency_summary_reports_p50_p95_and_success_rate():
    rows = [
        {"case_id": "a", "elapsed_ms": 100, "verdict": "PASS"},
        {"case_id": "b", "elapsed_ms": 200, "verdict": "FAIL"},
        {"case_id": "c", "elapsed_ms": 300, "verdict": "PASS"},
    ]
    summary = summarize_samples(rows)
    assert summary["count"] == 3
    assert summary["p50_ms"] == 200
    assert summary["p95_ms"] == 300
    assert summary["success_rate"] == pytest.approx(2 / 3)


def test_compare_modes_uses_paired_cases_and_reports_reduction():
    serial = [
        {"case_id": "a", "elapsed_ms": 1000, "verdict": "PASS"},
        {"case_id": "b", "elapsed_ms": 1200, "verdict": "PASS"},
    ]
    parallel = [
        {"case_id": "a", "elapsed_ms": 500, "verdict": "PASS"},
        {"case_id": "b", "elapsed_ms": 600, "verdict": "PASS"},
    ]
    result = compare_modes(serial, parallel)
    assert result["paired_cases"] == 2
    assert result["p50_reduction"] == pytest.approx(0.5)
    assert result["p95_reduction"] == pytest.approx(0.5)
    assert result["success_rate_delta"] == 0


def test_compare_modes_rejects_mismatched_case_sets():
    with pytest.raises(ValueError, match="case_id"):
        compare_modes([{"case_id": "a", "elapsed_ms": 1}], [{"case_id": "b", "elapsed_ms": 1}])
