# -*- coding: utf-8 -*-
"""真实 release 评测前的本地冻结检查。

本模块只读取数据、源码指纹和配置键是否存在，不初始化 Agent、向量库、精排器，
也不发起任何网络请求。`--strict` 只在所有输入完整、工作区干净且评测缓存已关闭时
返回非零码，避免把未冻结的工作区误当成可发布证据。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
from pathlib import Path
from typing import Any

import yaml

PROJECT_ROOT = Path(__file__).resolve().parents[2]

_DATASET_SPECS = {
    "product": {
        "path": Path("eval/v1/product_retrieval.jsonl"),
        "format": "jsonl",
        "expected": {"total": 150, "dev": 105, "release": 45},
    },
    "knowledge": {
        "path": Path("eval/v1/knowledge_retrieval.jsonl"),
        "format": "jsonl",
        "expected": {"total": 50, "dev": 35, "release": 15},
    },
    "agent": {
        "path": Path("eval/v1/agent_cases.yaml"),
        "format": "yaml_cases",
        "expected": {"total": 100, "dev": 70, "release": 30},
    },
}


def _file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _git_value(root: Path, args: list[str]) -> str | None:
    try:
        return subprocess.run(
            ["git", "-C", str(root), *args],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None


def _load_rows(path: Path, file_format: str) -> list[dict[str, Any]]:
    if file_format == "yaml_cases":
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
        rows = value.get("cases") if isinstance(value, dict) else None
    else:
        rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError("数据集必须是对象列表")
    return rows


def _dataset_result(root: Path, name: str, spec: dict[str, Any]) -> dict[str, Any]:
    path = root / spec["path"]
    result: dict[str, Any] = {
        "path": str(spec["path"]).replace("\\", "/"),
        "expected": dict(spec["expected"]),
        "counts": {"total": 0, "dev": 0, "release": 0},
        "errors": [],
    }
    if not path.is_file():
        result["errors"].append("文件不存在")
        return result
    result["file_sha256"] = _file_sha256(path)
    try:
        rows = _load_rows(path, spec["format"])
    except (OSError, ValueError, json.JSONDecodeError, yaml.YAMLError) as error:
        result["errors"].append(f"无法读取：{type(error).__name__}")
        return result

    result["counts"]["total"] = len(rows)
    ids: list[str] = []
    for index, row in enumerate(rows, 1):
        case_id = row.get("id")
        if not isinstance(case_id, str) or not case_id.strip():
            result["errors"].append(f"第 {index} 条缺少非空 id")
        else:
            ids.append(case_id)
        split = row.get("split")
        if split not in {"dev", "release"}:
            result["errors"].append(f"第 {index} 条 split 非 dev/release")
        else:
            result["counts"][split] += 1
    if len(ids) != len(set(ids)):
        result["errors"].append("id 重复")
    result["release_ids_sha256"] = hashlib.sha256(
        json.dumps(sorted(row["id"] for row in rows if isinstance(row.get("id"), str) and row.get("split") == "release"),
                   ensure_ascii=False, separators=(",", ":")).encode(),
    ).hexdigest()
    for key, expected in spec["expected"].items():
        if result["counts"][key] != expected:
            result["errors"].append(f"{key} 数量 {result['counts'][key]} != {expected}")
    return result


def check_release_datasets(root: Path = PROJECT_ROOT) -> dict[str, Any]:
    """检查三类正式集的总量、split、id 唯一性和文件指纹。"""
    datasets = {
        name: _dataset_result(root, name, spec)
        for name, spec in _DATASET_SPECS.items()
    }
    return {"ready": all(not item["errors"] for item in datasets.values()), "datasets": datasets}


def _dotenv_values(path: Path) -> dict[str, str]:
    """仅读取键和值是否为空；调用方不会把值写入报告。"""
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'\"")
        if key:
            values[key] = value
    return values


def _key_status(name: str, dotenv: dict[str, str], *, aliases: tuple[str, ...] = ()) -> dict[str, Any]:
    for candidate in (name, *aliases):
        if os.getenv(candidate, "").strip() or dotenv.get(candidate, "").strip():
            return {"configured": True, "source": "process_or_dotenv"}
    return {"configured": False, "source": "missing"}


def check_final_config(root: Path = PROJECT_ROOT) -> dict[str, Any]:
    """检查最终评测所需配置键，不输出任何密钥或配置值。"""
    dotenv = _dotenv_values(root / ".env")
    keys = {
        "LLM_API_KEY": _key_status("LLM_API_KEY", dotenv),
        "EMBEDDING_API_KEY": _key_status("EMBEDDING_API_KEY", dotenv, aliases=("LLM_API_KEY",)),
        "RERANKER_BASE_URL": _key_status("RERANKER_BASE_URL", dotenv),
        "RERANKER_MODEL": _key_status("RERANKER_MODEL", dotenv),
        "RERANKER_API_KEY": _key_status("RERANKER_API_KEY", dotenv, aliases=("LLM_API_KEY",)),
    }
    cache_value = os.getenv("SEMANTIC_CACHE_ENABLED") or dotenv.get("SEMANTIC_CACHE_ENABLED") or "1(default)"
    keys["SEMANTIC_CACHE_ENABLED"] = {
        "configured": cache_value in {"0", "false", "False"},
        "source": "process_or_dotenv" if cache_value != "1(default)" else "default",
    }
    required = ("LLM_API_KEY", "EMBEDDING_API_KEY", "RERANKER_BASE_URL", "RERANKER_MODEL", "RERANKER_API_KEY")
    return {"ready": all(keys[name]["configured"] for name in required) and keys["SEMANTIC_CACHE_ENABLED"]["configured"],
            "keys": keys}


def build_preflight(root: Path = PROJECT_ROOT) -> dict[str, Any]:
    """生成可保存的本地前置报告；不执行任何外部调用。"""
    datasets = check_release_datasets(root)
    config = check_final_config(root)
    try:
        from scripts.eval.run_manifest import worktree_fingerprint
        source = worktree_fingerprint(root)
        source["git_commit"] = _git_value(root, ["rev-parse", "HEAD"])
        dirty = _git_value(root, ["status", "--porcelain", "--untracked-files=normal", "--", "."])
        source["git_dirty"] = None if dirty is None else bool(dirty)
    except (ImportError, OSError) as error:
        source = {"sha256": None, "git_commit": None, "git_dirty": None, "error": type(error).__name__}
    source_clean = source.get("git_dirty") is False
    return {
        "schema_version": 1,
        "scope": "release_preflight_only_no_model_calls",
        "ready_for_final_release": datasets["ready"] and config["ready"] and source_clean,
        "datasets": datasets,
        "config": config,
        "source": {"sha256": source.get("sha256"), "git_commit": source.get("git_commit"),
                   "git_dirty": source.get("git_dirty"), "clean": source_clean},
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="只读 release 评测前置冻结检查")
    parser.add_argument("--root", type=Path, default=PROJECT_ROOT)
    parser.add_argument("--output", type=Path, help="可选 JSON 输出路径")
    parser.add_argument("--strict", action="store_true", help="未达到最终评测条件时返回非零码")
    args = parser.parse_args(argv)
    report = build_preflight(args.root.resolve())
    encoded = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    else:
        print(encoded, end="")
    return 1 if args.strict and not report["ready_for_final_release"] else 0


if __name__ == "__main__":  # pragma: no cover - CLI 薄封装
    raise SystemExit(main())
