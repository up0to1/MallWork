# -*- coding: utf-8 -*-
from __future__ import annotations

import pytest
from types import SimpleNamespace

from app.application.agents.orchestrator import MainAgentOrchestrator, SubmitIntentInput
from app.infrastructure.cache.agui_structured_cache import (
    AGUICachedResponse,
    StructuredCacheTicket,
    StructuredSemanticCache,
)

pytestmark = pytest.mark.asyncio


class MemoryCache:
    def __init__(self) -> None:
        self.enabled = True
        self.values: dict[str, object] = {}
        self.ttls: dict[str, int] = {}

    async def get_json(self, key: str):
        return self.values.get(key)

    async def set_json(self, key: str, value, ttl_seconds: int) -> None:
        self.values[key] = value
        self.ttls[key] = ttl_seconds


class ExactEmbedder:
    def __init__(self) -> None:
        self.calls = 0

    async def embed(self, text: str) -> list[float]:
        self.calls += 1
        if "露营灯" in text:
            return [1.0, 0.0]
        return [0.0, 1.0]


class BrokenCache(MemoryCache):
    async def get_json(self, key: str):
        raise RuntimeError("redis unavailable")

    async def set_json(self, key: str, value, ttl_seconds: int) -> None:
        raise RuntimeError("redis unavailable")


def ticket(*, buyer: str = "buyer-1", version: str = "v1", preference: str = "pref-a"):
    return StructuredCacheTicket(
        buyer_id=buyer,
        preference_scope=preference,
        locale="zh-CN",
        currency="CNY",
        version=version,
    )


def response() -> AGUICachedResponse:
    return AGUICachedResponse.from_runtime(
        "推荐这款露营灯。",
        {
            "products": [{
                "product_id": "P-1",
                "title": "轻量露营灯",
                "price_major": "89.00",
                "currency": "CNY",
                "image_url": "https://example.test/lamp.jpg",
                "internal_debug": "must-not-be-cached",
            }],
            "searchCompleted": True,
            "confirmations": [{"confirmation_id": "secret"}],
            "skillUsages": [{"id": "private-skill"}],
            "progress": [{"id": "tool-call"}],
        },
    )


async def test_projection_keeps_only_replay_safe_fields():
    cached = response()

    assert cached.final_text == "推荐这款露营灯。"
    assert cached.search_completed is True
    assert cached.products == [{
        "product_id": "P-1",
        "title": "轻量露营灯",
        "price_major": "89.00",
        "currency": "CNY",
        "image_url": "https://example.test/lamp.jpg",
    }]
    serialized = cached.to_dict()
    assert "confirmations" not in serialized
    assert "skillUsages" not in serialized
    assert "progress" not in serialized


async def test_same_scope_hit_restores_reply_and_cards_with_ten_minute_ttl():
    storage = MemoryCache()
    embedder = ExactEmbedder()
    cache = StructuredSemanticCache(storage, embedder, threshold=0.95, ttl_seconds=600)

    await cache.remember(ticket(), "推荐一款露营灯", response())
    hit = await cache.lookup(ticket(), "想买一个露营灯")

    assert hit is not None
    assert hit.response == response()
    assert hit.similarity == 1.0
    assert set(storage.ttls.values()) == {600}


class PreferenceStore:
    def __init__(self, values=None) -> None:
        self.values = values or []

    async def list_by_buyer(self, buyer_id: str):
        return self.values


class PrivateSkillStore:
    def __init__(self, values=None) -> None:
        self.values = values or []

    def list(self, buyer_id: str):
        return self.values


def orchestrator(*, trade=None, private_skills=None, enabled=True, server_history=False, dynamic_version=""):
    structured_cache = SimpleNamespace(enabled=enabled)
    sessions = SimpleNamespace(
        _main_factory=SimpleNamespace(buyer_skill_store=PrivateSkillStore(private_skills)),
    )
    async def has_history(session_id: str):
        return server_history
    sessions.has_history = has_history
    async def cache_context_version(session_id: str, buyer_id: str):
        return dynamic_version
    sessions.cache_context_version = cache_context_version

    async def trade_state(buyer_id: str, session_id: str):
        return trade or {}

    return MainAgentOrchestrator(
        sessions,
        SimpleNamespace(publish=lambda *args, **kwargs: None),
        PreferenceStore(),
        structured_cache=structured_cache,
        structured_cache_version="model:prompt:catalog:retrieval",
        trade_state_provider=trade_state,
    )


def intent(query="推荐一款露营灯", selected_skill=None):
    return SubmitIntentInput("s1", "buyer-1", "zh-CN", "CNY", query, selected_skill)


@pytest.mark.parametrize(
    ("query", "outcome"),
    [
        ("帮我下单这款露营灯", "bypass_unsafe"),
        ("记住我喜欢蓝色商品", "bypass_unsafe"),
        ("删除我不要塑料的偏好", "bypass_unsafe"),
        ("刚才那个换成红色", "bypass_unsafe"),
    ],
)
async def test_orchestrator_policy_rejects_stateful_queries(query, outcome):
    decision = await orchestrator().prepare_structured_cache(intent(query))
    assert decision.ticket is None
    assert decision.outcome == outcome


async def test_orchestrator_policy_builds_complete_first_turn_ticket():
    decision = await orchestrator(dynamic_version="prompt-live:cap-live").prepare_structured_cache(intent())

    assert decision.outcome == "eligible"
    assert decision.ticket == StructuredCacheTicket(
        buyer_id="buyer-1",
        preference_scope="",
        locale="zh-CN",
        currency="CNY",
        version="model:prompt:catalog:retrieval:prompt-live:cap-live",
    )


@pytest.mark.parametrize(
    ("kwargs", "has_history", "outcome"),
    [
        ({"enabled": False}, False, "disabled"),
        ({}, True, "bypass_history"),
        ({"server_history": True}, False, "bypass_history"),
        ({"trade": {"orders": [{"id": "O1"}]}}, False, "bypass_policy"),
        ({"private_skills": [{"id": "personal"}]}, False, "bypass_policy"),
    ],
)
async def test_orchestrator_policy_rejects_context_dependent_scope(kwargs, has_history, outcome):
    decision = await orchestrator(**kwargs).prepare_structured_cache(intent(), has_history=has_history)
    assert decision.ticket is None
    assert decision.outcome == outcome


@pytest.mark.parametrize(
    "other_ticket",
    [
        ticket(buyer="buyer-2"),
        ticket(version="v2"),
        ticket(preference="pref-b"),
        StructuredCacheTicket("buyer-1", "pref-a", "en-US", "USD", "v1"),
    ],
)
async def test_scope_dimensions_never_cross_hit(other_ticket):
    storage = MemoryCache()
    cache = StructuredSemanticCache(storage, ExactEmbedder(), threshold=0.95)
    await cache.remember(ticket(), "推荐一款露营灯", response())

    assert await cache.lookup(other_ticket, "推荐一款露营灯") is None


async def test_unsafe_or_failed_response_is_never_cached():
    storage = MemoryCache()
    cache = StructuredSemanticCache(storage, ExactEmbedder(), threshold=0.95)

    await cache.remember(ticket(), "帮我下单这款露营灯", response())
    await cache.remember(ticket(), "推荐一款露营灯", AGUICachedResponse.from_runtime("[error] timeout", {}))

    assert storage.values == {}


@pytest.mark.parametrize("query", ["我喜欢蓝色商品，推荐一款", "以后不要给我推荐塑料制品"])
async def test_preference_statements_are_not_page_cacheable(query):
    storage = MemoryCache()
    cache = StructuredSemanticCache(storage, ExactEmbedder(), threshold=0.95)
    await cache.remember(ticket(), query, response())
    assert storage.values == {}


async def test_redis_failure_degrades_to_miss_without_breaking_request():
    cache = StructuredSemanticCache(BrokenCache(), ExactEmbedder(), threshold=0.95)

    assert await cache.lookup(ticket(), "推荐一款露营灯") is None
    await cache.remember(ticket(), "推荐一款露营灯", response())
