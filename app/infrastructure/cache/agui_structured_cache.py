# -*- coding: utf-8 -*-
"""AG-UI 页面链路使用的结构化语义缓存。

缓存只保存可安全重放的最终回复、商品卡与检索完成标记。运行 ID、工具事件、
确认单、Skill 使用记录和进度均由当前请求重新产生或重新加载，绝不跨运行复用。
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass
from typing import Any

from app.domain.catalog.ports.retrieval_ports import EmbeddingClient
from app.infrastructure.cache.redis_cache import RedisCache
from app.infrastructure.cache.semantic_cache import _cosine, _normalize, is_cacheable_query

logger = logging.getLogger(__name__)

_SCHEMA_VERSION = 1
_BUCKET_LIMIT = 30
_MAX_PRODUCTS = 20
_MAX_FINAL_TEXT_CHARS = 50_000
_MAX_RESPONSE_BYTES = 256 * 1024
_PRODUCT_FIELDS = frozenset({
    "product_id", "title", "brand", "category", "origin_country", "price_major",
    "currency", "source_price_major", "source_currency", "highlights", "skus",
    "score", "source_platform", "canonical_product_id", "material_tags", "weight_kg",
    "description", "rating_summary", "rating_is_live", "ships_to", "dimensions_cm",
    "updated_at", "default_sku_id", "image_url", "image_kind", "image_alt",
    "landed_price",
})
_STATEFUL_QUERY_RE = re.compile(
    r"(?:记住|记下|保存|新增|添加|更新|修改|删除|移除|忘记|撤回).{0,16}"
    r"(?:偏好|喜好|习惯|黑名单|不喜欢|喜欢)|"
    r"(?:偏好|喜好|习惯|黑名单).{0,16}(?:记住|保存|更新|修改|删除|移除|忘记|撤回)|"
    r"(?:我|本人).{0,4}(?:喜欢|不喜欢|偏爱|讨厌)|"
    r"(?:以后|今后|从今往后).{0,20}(?:不要|只要|别给我推荐)|"
    r"(?:别|不要).{0,8}(?:推荐|记住)",
)


def is_structured_cache_query(query: str) -> bool:
    """结构化页面缓存只接受无副作用、无会话指代的只读问句。"""
    return is_cacheable_query(query) and not _STATEFUL_QUERY_RE.search(query)


@dataclass(frozen=True)
class StructuredCacheTicket:
    """所有会改变页面答案的作用域维度。"""

    buyer_id: str
    preference_scope: str
    locale: str
    currency: str
    version: str


@dataclass(frozen=True)
class AGUICachedResponse:
    schema_version: int
    final_text: str
    products: list[dict[str, Any]]
    search_completed: bool

    @classmethod
    def from_runtime(cls, final_text: str, state: dict[str, Any]) -> "AGUICachedResponse":
        raw_products = state.get("products", []) if isinstance(state, dict) else []
        products: list[dict[str, Any]] = []
        if isinstance(raw_products, list):
            for product in raw_products[:_MAX_PRODUCTS]:
                if not isinstance(product, dict):
                    continue
                safe = {key: value for key, value in product.items() if key in _PRODUCT_FIELDS}
                try:
                    # JSON 往返既做深拷贝，也拒绝不可序列化的运行时对象。
                    products.append(json.loads(json.dumps(safe, ensure_ascii=False)))
                except (TypeError, ValueError):
                    continue
        return cls(
            schema_version=_SCHEMA_VERSION,
            final_text=final_text if isinstance(final_text, str) else "",
            products=products,
            search_completed=bool(state.get("searchCompleted", False)) if isinstance(state, dict) else False,
        )

    @classmethod
    def from_dict(cls, value: Any) -> "AGUICachedResponse | None":
        if not isinstance(value, dict) or value.get("schema_version") != _SCHEMA_VERSION:
            return None
        final_text = value.get("final_text")
        products = value.get("products")
        search_completed = value.get("search_completed")
        if not isinstance(final_text, str) or not isinstance(products, list) or not isinstance(search_completed, bool):
            return None
        # 再走一次投影，防止 Redis 中的旧值或人工写入字段越权进入页面状态。
        projected = cls.from_runtime(final_text, {
            "products": products,
            "searchCompleted": search_completed,
        })
        return projected if projected.is_valid else None

    @property
    def is_valid(self) -> bool:
        if not self.final_text or self.final_text.startswith("[error]"):
            return False
        if len(self.final_text) > _MAX_FINAL_TEXT_CHARS:
            return False
        try:
            return len(json.dumps(self.to_dict(), ensure_ascii=False).encode("utf-8")) <= _MAX_RESPONSE_BYTES
        except (TypeError, ValueError):
            return False

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "final_text": self.final_text,
            "products": self.products,
            "search_completed": self.search_completed,
        }


@dataclass(frozen=True)
class StructuredCacheHit:
    response: AGUICachedResponse
    similarity: float
    matched_query: str


class StructuredSemanticCache:
    def __init__(
        self,
        cache: RedisCache,
        embedder: EmbeddingClient,
        *,
        threshold: float = 0.95,
        ttl_seconds: int = 600,
        enabled: bool = True,
        namespace: str = "",
    ) -> None:
        self._cache = cache
        self._embedder = embedder
        self._threshold = threshold
        self._ttl_seconds = max(1, ttl_seconds)
        self._enabled = enabled and bool(cache.enabled)
        self._namespace = namespace

    @property
    def enabled(self) -> bool:
        return self._enabled

    def _bucket_key(self, ticket: StructuredCacheTicket) -> str:
        dimensions = "\n".join((
            str(_SCHEMA_VERSION), self._namespace, ticket.version, ticket.buyer_id,
            ticket.preference_scope, ticket.locale, ticket.currency,
        ))
        digest = hashlib.sha256(dimensions.encode("utf-8")).hexdigest()[:24]
        return f"agui-semcache:{digest}"

    async def _load_entries(self, ticket: StructuredCacheTicket) -> list[dict[str, Any]]:
        try:
            value = await self._cache.get_json(self._bucket_key(ticket))
        except Exception as err:  # noqa: BLE001
            logger.warning("AG-UI 结构化缓存读取失败，按未命中处理：%s", err)
            return []
        return [entry for entry in value if isinstance(entry, dict)] if isinstance(value, list) else []

    async def lookup(self, ticket: StructuredCacheTicket, query: str) -> StructuredCacheHit | None:
        if not self._enabled or not is_structured_cache_query(query):
            return None
        entries = await self._load_entries(ticket)
        if not entries:
            return None
        try:
            vector = await self._embedder.embed(_normalize(query))
        except Exception as err:  # noqa: BLE001
            logger.warning("AG-UI 结构化缓存向量查询失败，按未命中处理：%s", err)
            return None

        best: StructuredCacheHit | None = None
        for entry in entries:
            response = AGUICachedResponse.from_dict(entry.get("response"))
            if response is None:
                continue
            similarity = _cosine(vector, entry.get("vector", []))
            if similarity >= self._threshold and (best is None or similarity > best.similarity):
                best = StructuredCacheHit(
                    response=response,
                    similarity=round(similarity, 4),
                    matched_query=str(entry.get("query", "")),
                )
        return best

    async def remember(
        self,
        ticket: StructuredCacheTicket,
        query: str,
        response: AGUICachedResponse,
    ) -> None:
        if not self._enabled or not is_structured_cache_query(query) or not response.is_valid:
            return
        try:
            vector = await self._embedder.embed(_normalize(query))
        except Exception as err:  # noqa: BLE001
            logger.warning("AG-UI 结构化缓存写入向量失败，跳过：%s", err)
            return
        entries = await self._load_entries(ticket)
        entries.append({
            "query": _normalize(query),
            "vector": vector,
            "response": response.to_dict(),
        })
        try:
            await self._cache.set_json(
                self._bucket_key(ticket), entries[-_BUCKET_LIMIT:], self._ttl_seconds,
            )
        except Exception as err:  # noqa: BLE001
            logger.warning("AG-UI 结构化缓存写入失败，跳过：%s", err)
