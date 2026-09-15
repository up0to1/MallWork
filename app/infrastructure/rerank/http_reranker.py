# -*- coding: utf-8 -*-
"""HttpReranker

HTTP 精排客户端（对接 Qwen3-Reranker 等 /rerank 协议服务）。
RERANKER_BASE_URL 未配置时组装根不会实例化本类；调用失败抛异常，
由 CatalogSearchUseCase 降级为按向量分排序并标注 rerank_applied=false。
"""
from __future__ import annotations

import httpx

from app.domain.catalog.ports.retrieval_ports import Reranker
from app.infrastructure.settings import Settings


class HttpReranker(Reranker):
    def __init__(self, settings: Settings, timeout_seconds: float = 3.0) -> None:
        endpoint = settings.reranker_base_url.rstrip("/")
        self._dashscope = settings.reranker_protocol == "dashscope"
        if self._dashscope:
            dashscope_path = "/api/v1/services/rerank/text-rerank/text-rerank"
            api_v1_path = "/api/v1"
            if endpoint.endswith(dashscope_path):
                self._url = endpoint
            elif endpoint.endswith(api_v1_path):
                self._url = f"{endpoint}/services/rerank/text-rerank/text-rerank"
            else:
                self._url = f"{endpoint}{dashscope_path}"
        else:
            # 内部网关给出的是完整 /services/reranker endpoint；通用服务若只给根地址，
            # 仍兼容补上 /rerank。
            self._url = (
                endpoint
                if endpoint.endswith(("/rerank", "/reranker"))
                else f"{endpoint}/rerank"
            )
        self._api_key = settings.reranker_api_key or settings.llm_api_key
        self._model = settings.reranker_model
        self._timeout = timeout_seconds

    async def rerank(self, query: str, documents: list[str]) -> list[float]:
        if not documents:
            return []
        request_body = (
            {
                "model": self._model,
                "input": {"query": query, "documents": documents},
            }
            if self._dashscope
            else {"model": self._model, "query": query, "documents": documents}
        )
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(
                self._url,
                headers={"Authorization": f"Bearer {self._api_key}"},
                json=request_body,
            )
            response.raise_for_status()
            body = response.json()
        # 兼容 {results:[{index, relevance_score}]} 协议（Jina/TEI/vLLM rerank 通用形态）
        results = body.get("output", {}).get("results") if self._dashscope else body.get("results")
        if not isinstance(results, list) or len(results) != len(documents):
            raise RuntimeError(f"rerank 响应异常：{str(body)[:200]}")
        scores = [0.0] * len(documents)
        for item in results:
            scores[item["index"]] = float(item.get("relevance_score", item.get("score", 0.0)))
        return scores
