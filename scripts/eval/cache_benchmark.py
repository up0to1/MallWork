# -*- coding: utf-8 -*-
"""AG-UI 结构化语义缓存 benchmark。

默认只生成并校验 20 组、共 100 条只读商品请求，不访问服务。显式传入
``--execute`` 才会依次执行真实页面链路；每组首条回源 Agent，后四条用于验证
语义命中、商品卡/最终回复一致性和命中时零 Agent 流事件。报告不保存回复正文。
"""
from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import time
from typing import Any
import uuid

import httpx


_TOPICS = (
    ("travel-kit", "适合长途飞行的旅行三件套"),
    ("carry-on", "20 寸可登机行李箱"),
    ("folding-backpack", "轻便可折叠旅行双肩包"),
    ("noise-cancelling", "适合飞行的主动降噪蓝牙耳机"),
    ("travel-charger", "65W 全球插脚旅行充电器"),
    ("tea-set", "便携旅行茶具套装"),
    ("quick-dry-towel", "速干旅行毛巾套装"),
    ("camping-lamp", "可充电防水露营灯"),
    ("sleep-mask", "真丝遮光旅行眼罩"),
    ("trekking-poles", "轻量可折叠登山杖"),
    ("travel-pillow", "长途飞行护颈枕"),
    ("packing-cubes", "旅行压缩收纳袋"),
    ("waterproof-pack", "户外防水背包"),
    ("travel-bottle", "可折叠旅行水杯"),
    ("rfid-wallet", "RFID 防盗证件收纳包"),
    ("luggage-scale", "便携行李电子秤"),
    ("earplugs", "旅行睡眠降噪耳塞"),
    ("shoe-bag", "可折叠旅行鞋袋"),
    ("steam-iron", "便携旅行蒸汽熨斗"),
    ("daypack", "高性价比轻量日用背包"),
)


def default_dataset() -> list[dict[str, Any]]:
    return [{
        "id": identifier,
        "seed": f"推荐{topic}",
        "variants": [
            f"请推荐{topic}",
            f"帮我推荐{topic}",
            f"想找{topic}，给我几个选择",
            f"{topic}有什么推荐",
        ],
    } for identifier, topic in _TOPICS]


def validate_dataset(dataset: list[dict[str, Any]]) -> None:
    if len(dataset) != 20 or len({row.get("id") for row in dataset}) != 20:
        raise ValueError("benchmark 必须包含 20 个唯一主题")
    if any(not isinstance(row.get("seed"), str) or len(row.get("variants", [])) != 4 for row in dataset):
        raise ValueError("每个主题必须包含 1 条 seed 和 4 条 variants")
    queries = [query for row in dataset for query in [row["seed"], *row["variants"]]]
    if len(queries) != 100 or len(set(queries)) != 100:
        raise ValueError("100 条 eligible query 必须全部非空且唯一")


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    eligible = [row for row in rows if row.get("kind") in {"seed", "variant"}]
    repeats = [row for row in eligible if row.get("kind") == "variant"]
    controls = [row for row in rows if row.get("kind") == "control"]
    hits = [row for row in eligible if row.get("cache_hit") is True]
    consistent_hits = [row for row in hits if row.get("replay_consistent") is True]
    false_hits = [row for row in hits if row.get("replay_consistent") is False]
    expected_bypass = [row for row in controls if row.get("expected_bypass") is True]
    bypassed = [row for row in expected_bypass if row.get("cache_hit") is False]
    hit_rate = len(hits) / len(eligible) if eligible else None
    repeat_hits = [row for row in repeats if row.get("cache_hit") is True]
    repeat_hit_rate = len(repeat_hits) / len(repeats) if repeats else None
    consistency = len(consistent_hits) / len(hits) if hits else None
    bypass_accuracy = len(bypassed) / len(expected_bypass) if expected_bypass else None
    agent_path_events = sum(int(row.get("agent_path_events", 0)) for row in hits)
    invalid_seeds = sum(row.get("kind") == "seed" and row.get("seed_valid") is not True for row in eligible)
    unexpected_seed_hits = sum(row.get("kind") == "seed" and row.get("cache_hit") is True for row in eligible)
    gates = {
        "eligible_count_100": len(eligible) == 100,
        # 冷启动 seed 必然是 miss；缓存命中率口径只看四条重复变体。
        "repeat_hit_rate_gte_0_80": repeat_hit_rate is not None and repeat_hit_rate >= 0.80,
        "replay_consistency_1_0": consistency == 1.0,
        "bypass_accuracy_1_0": bypass_accuracy in {None, 1.0},
        "false_hits_0": not false_hits,
        "agent_path_events_on_hits_0": agent_path_events == 0,
        "all_seeds_valid": invalid_seeds == 0,
        "unexpected_seed_hits_0": unexpected_seed_hits == 0,
    }
    return {
        "eligible_lookups": len(eligible),
        "hits": len(hits),
        "misses": len(eligible) - len(hits),
        "hit_rate": hit_rate,
        "repeat_lookups": len(repeats),
        "repeat_hits": len(repeat_hits),
        "repeat_hit_rate": repeat_hit_rate,
        "replay_consistency": consistency,
        "bypass_controls": len(expected_bypass),
        "bypass_accuracy": bypass_accuracy,
        "false_hits": len(false_hits),
        "agent_path_events_on_hits": agent_path_events,
        "invalid_seeds": invalid_seeds,
        "unexpected_seed_hits": unexpected_seed_hits,
        "gates": gates,
        "gate": "PASS" if all(gates.values()) else "BLOCK",
    }


def _request(buyer_id: str, query: str, *, history: bool = False) -> tuple[dict[str, Any], str, str]:
    thread_id, run_id = f"cache-bench-{uuid.uuid4().hex}", f"run-{uuid.uuid4().hex}"
    messages = []
    if history:
        messages.extend([
            {"id": f"u-old-{uuid.uuid4().hex}", "role": "user", "content": "我在看旅行用品"},
            {"id": f"a-old-{uuid.uuid4().hex}", "role": "assistant", "content": "可以继续说具体需求。"},
        ])
    messages.append({"id": f"u-{uuid.uuid4().hex}", "role": "user", "content": query})
    return ({
        "threadId": thread_id,
        "runId": run_id,
        "state": {},
        "tools": [],
        "context": [],
        "forwardedProps": {"buyerId": buyer_id, "locale": "zh-CN", "currency": "CNY"},
        "messages": messages,
    }, thread_id, run_id)


async def _events(client: httpx.AsyncClient, payload: dict[str, Any]) -> tuple[list[dict[str, Any]], float]:
    started = time.perf_counter()
    events: list[dict[str, Any]] = []
    async with client.stream("POST", "/commerce/ag-ui/run", json=payload) as response:
        response.raise_for_status()
        if "text/event-stream" not in response.headers.get("content-type", ""):
            raise RuntimeError("AG-UI endpoint did not return SSE")
        async for line in response.aiter_lines():
            if line.startswith("data:"):
                events.append(json.loads(line[5:].lstrip()))
    return events, (time.perf_counter() - started) * 1000


def _projection(events: list[dict[str, Any]]) -> dict[str, Any]:
    states = [event.get("snapshot") for event in events if event.get("type") == "STATE_SNAPSHOT"]
    message_sets = [event.get("messages") for event in events if event.get("type") == "MESSAGES_SNAPSHOT"]
    state = states[-1] if states and isinstance(states[-1], dict) else {}
    messages = message_sets[-1] if message_sets and isinstance(message_sets[-1], list) else []
    assistants = [message for message in messages if isinstance(message, dict) and message.get("role") == "assistant"]
    final_text = str(assistants[-1].get("content", "")) if assistants else ""
    products = state.get("products", []) if isinstance(state.get("products"), list) else []
    cache_hit = any(
        event.get("type") == "CUSTOM" and event.get("name") == "cache.hit"
        for event in events
    )
    agent_types = {"TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_RESULT"}
    return {
        "cache_hit": cache_hit,
        "agent_path_events": sum(event.get("type") in agent_types for event in events),
        "terminal": events[-1].get("type") if events else None,
        "search_completed": state.get("searchCompleted") is True,
        "products": products,
        "final_text": final_text,
    }


async def execute(
    dataset: list[dict[str, Any]],
    *,
    base_url: str,
    timeout: float,
    bearer_token: str = "",
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    validate_dataset(dataset)
    buyer_id = f"cache-benchmark-{uuid.uuid4().hex}"
    headers = {"Authorization": f"Bearer {bearer_token}"} if bearer_token else {}
    rows: list[dict[str, Any]] = []
    async with httpx.AsyncClient(
        base_url=base_url.rstrip("/"),
        timeout=httpx.Timeout(timeout, connect=10),
        headers=headers,
    ) as client:
        health_response = await client.get("/health")
        health_response.raise_for_status()
        health = health_response.json()
        if health.get("agui_structured_cache") is not True or health.get("redis") != "ok":
            raise RuntimeError("benchmark 要求 /health 的 agui_structured_cache=true 且 redis=ok")

        for topic in dataset:
            reference = None
            for index, query in enumerate([topic["seed"], *topic["variants"]]):
                payload, _, _ = _request(buyer_id, query)
                events, elapsed_ms = await _events(client, payload)
                projection = _projection(events)
                if index == 0:
                    reference = projection
                    consistent = None
                else:
                    consistent = bool(
                        reference
                        and projection["final_text"] == reference["final_text"]
                        and projection["products"] == reference["products"]
                        and projection["search_completed"] == reference["search_completed"]
                    )
                rows.append({
                    "case_id": f"{topic['id']}-{'seed' if index == 0 else f'v{index}'}",
                    "kind": "seed" if index == 0 else "variant",
                    "cache_hit": projection["cache_hit"],
                    "replay_consistent": consistent,
                    "agent_path_events": projection["agent_path_events"],
                    "seed_valid": bool(
                        reference and reference["terminal"] == "RUN_FINISHED"
                        and reference["search_completed"] and reference["products"] and reference["final_text"]
                    ),
                    "elapsed_ms": round(elapsed_ms, 2),
                    "final_text_sha256": hashlib.sha256(projection["final_text"].encode("utf-8")).hexdigest(),
                    "product_ids": [item.get("product_id") for item in projection["products"] if isinstance(item, dict)],
                })

        controls = [
            ("unsafe-1", "刚才那个旅行背包怎么样", False),
            ("unsafe-2", "刚才那个旅行背包怎么样", False),
            ("history-1", "推荐轻量旅行背包", True),
            ("history-2", "推荐轻量旅行背包", True),
        ]
        for identifier, query, history in controls:
            payload, _, _ = _request(buyer_id, query, history=history)
            events, elapsed_ms = await _events(client, payload)
            projection = _projection(events)
            rows.append({
                "case_id": identifier,
                "kind": "control",
                "expected_bypass": True,
                "cache_hit": projection["cache_hit"],
                "elapsed_ms": round(elapsed_ms, 2),
            })
    return rows, {
        "status": health.get("status"),
        "model": health.get("model"),
        "redis": health.get("redis"),
        "agui_structured_cache": health.get("agui_structured_cache"),
        "runtime": health.get("runtime", {}),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="显式允许执行 100 条真实页面请求与 4 条安全控制")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--timeout", type=float, default=600)
    parser.add_argument("--dataset", type=Path, default=Path("eval/cache/benchmark-v1.json"))
    parser.add_argument("--output", type=Path, default=Path("eval/cache/latest-report.json"))
    args = parser.parse_args(argv)
    dataset = default_dataset()
    validate_dataset(dataset)
    args.dataset.parent.mkdir(parents=True, exist_ok=True)
    args.dataset.write_text(json.dumps(dataset, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not args.execute:
        print(json.dumps({
            "mode": "dry-run",
            "topics": len(dataset),
            "eligible_lookups": 100,
            "network_requests": 0,
            "dataset": str(args.dataset),
        }, ensure_ascii=False, indent=2))
        return 0
    rows, health = asyncio.run(execute(
        dataset,
        base_url=args.base_url,
        timeout=args.timeout,
        bearer_token=os.getenv("MALLWORK_BENCHMARK_TOKEN", ""),
    ))
    report = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scope": "agui_first_turn_read_only_structured_semantic_cache",
        "health": health,
        "metrics": summarize(rows),
        "observations": rows,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), **report["metrics"]}, ensure_ascii=False, indent=2))
    return 0 if report["metrics"]["gate"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
