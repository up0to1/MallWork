# -*- coding: utf-8 -*-
"""离线检索 runner 不应因可选的 Qdrant 客户端缺失而无法启动。"""
import subprocess
import sys


def test_bm25_runner_imports_without_qdrant_dependency():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from scripts.eval.run_product_recall import profile_thresholds; "
            "assert profile_thresholds('offline-fallback').recall == 0.0",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
