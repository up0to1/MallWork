# -*- coding: utf-8 -*-
"""发布前冻结检查的纯本地契约。"""
import json
from pathlib import Path

import yaml

from scripts.eval.release_preflight import check_release_datasets
from scripts.eval.release_preflight import build_preflight


def _write_fixture(root, *, product_count=150, product_release=45):
    directory = root / "eval" / "v1"
    directory.mkdir(parents=True)
    products = [
        {"id": f"p-{i}", "split": "release" if i < product_release else "dev"}
        for i in range(product_count)
    ]
    (directory / "product_retrieval.jsonl").write_text(
        "\n".join(json.dumps(row) for row in products) + "\n", encoding="utf-8",
    )
    knowledge = [
        {"id": f"k-{i}", "split": "release" if i < 15 else "dev"}
        for i in range(50)
    ]
    (directory / "knowledge_retrieval.jsonl").write_text(
        "\n".join(json.dumps(row) for row in knowledge) + "\n", encoding="utf-8",
    )
    agents = [{"id": f"a-{i}", "split": "release" if i < 30 else "dev"} for i in range(100)]
    (directory / "agent_cases.yaml").write_text(yaml.safe_dump({"cases": agents}), encoding="utf-8")


def test_release_preflight_accepts_expected_release_split_counts(tmp_path):
    _write_fixture(tmp_path)

    result = check_release_datasets(tmp_path)

    assert result["ready"] is True
    assert result["datasets"]["product"]["counts"] == {"total": 150, "dev": 105, "release": 45}
    assert result["datasets"]["knowledge"]["counts"] == {"total": 50, "dev": 35, "release": 15}
    assert result["datasets"]["agent"]["counts"] == {"total": 100, "dev": 70, "release": 30}


def test_release_preflight_rejects_incomplete_product_release_split(tmp_path):
    _write_fixture(tmp_path, product_release=44)

    result = check_release_datasets(tmp_path)

    assert result["ready"] is False
    assert result["datasets"]["product"]["counts"]["release"] == 44
    assert result["datasets"]["product"]["errors"]


def test_release_preflight_records_git_snapshot_for_freeze_audit():
    report = build_preflight(Path(__file__).resolve().parents[1])

    assert isinstance(report["source"]["git_commit"], str)
    assert isinstance(report["source"]["git_dirty"], bool)
