# -*- coding: utf-8 -*-
"""运行独立于 HTTP 订阅存在；日志写入成功后事件才对 SSE 可见。"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
import logging
import time
import uuid

from ag_ui.core import RunAgentInput

from app.application.agents.ag_ui_adapter import AGUIRunAdapter
from app.application.agents.orchestrator import SubmitIntentInput
from app.infrastructure.ag_ui_journal import AGUIJournal, JournalLeaseLost
from app.infrastructure.eventbus import observe_run_events
from app.infrastructure.cache.agui_structured_cache import AGUICachedResponse, StructuredSemanticCache

logger = logging.getLogger(__name__)


@dataclass
class Running:
    owner: str
    deadline: float
    valid: bool = True
    reason: str = ""
    task: asyncio.Task | None = None

    def is_valid(self):
        return self.valid and time.monotonic() < self.deadline


class AGUIRuntime:
    def __init__(
        self,
        journal: AGUIJournal,
        orchestrator,
        confirmations=None,
        *,
        structured_cache: StructuredSemanticCache | None = None,
        cache_metrics=None,
        lease_seconds=30,
        heartbeat_seconds=5,
    ):
        self.journal, self.orchestrator, self.confirmations = journal, orchestrator, confirmations
        self.structured_cache = structured_cache
        if cache_metrics is None:
            from app.infrastructure.cache.telemetry import registry as cache_metrics
        self.cache_metrics = cache_metrics
        self.lease_seconds, self.heartbeat_seconds = lease_seconds, heartbeat_seconds
        self.running: dict[str, Running] = {}

    async def startup(self):
        await self.journal.initialize()
        await self.journal.recover_expired()

    async def shutdown(self):
        active = list(self.running.items())
        for _, entry in active:
            entry.reason = "restart"
            entry.valid = False
            if entry.task:
                entry.task.cancel()
        await asyncio.gather(*(entry.task for _, entry in active if entry.task), return_exceptions=True)
        for run_id, entry in active:
            await self.journal.end_owned(run_id, entry.owner)
            self.running.pop(run_id, None)

    async def start(self, body: RunAgentInput, intent: SubmitIntentInput):
        owner = uuid.uuid4().hex
        started = time.monotonic()
        run, created = await self.journal.reserve(body.model_dump(mode="json", by_alias=True), intent.buyer_id, owner, self.lease_seconds)
        if created:
            entry = Running(owner, started + self.lease_seconds)
            self.running[body.run_id] = entry
            effective = RunAgentInput.model_validate(run["input"])
            entry.task = asyncio.create_task(self._produce(effective, intent, entry), name=f"agui-run:{body.run_id}")
        return run

    async def cancel(self, run_id, buyer_id):
        run = await self.journal.request_stop(run_id, buyer_id)
        entry = self.running.get(run_id)
        if entry and entry.task:
            entry.reason = "stop"
            entry.valid = False
            entry.task.cancel()
            await asyncio.shield(asyncio.gather(entry.task, return_exceptions=True))
            await self.journal.end_owned(run_id, entry.owner, stopped=True)
            self.running.pop(run_id, None)
            run = await self.journal.run(run_id, buyer_id)
        return run

    async def _produce(self, body, intent, entry):
        queue = asyncio.Queue()
        adapter = AGUIRunAdapter(body, queue.put_nowait)

        async def write_events():
            while True:
                event = await queue.get()
                if event is None:
                    return
                events = [event]
                ending = False
                while len(events) < 64 and not queue.empty():
                    following = queue.get_nowait()
                    if following is None:
                        ending = True
                        break
                    events.append(following)
                payloads = [value.model_dump(mode="json", by_alias=True, exclude_none=True) for value in events]
                if entry.reason == "restart":
                    for value in payloads:
                        if value["type"] == "RUN_ERROR":
                            value["code"] = "SERVER_RESTART"
                try:
                    await self.journal.append(body.run_id, entry.owner, payloads)
                except Exception:
                    entry.valid = False
                    entry.reason = "restart"
                    if entry.task:
                        entry.task.cancel()
                    raise
                if ending:
                    return

        async def heartbeat():
            while True:
                await asyncio.sleep(self.heartbeat_seconds)
                started = time.monotonic()
                try:
                    renewed = await asyncio.wait_for(self.journal.renew(body.run_id, entry.owner, self.lease_seconds),
                                                    max(0.001, entry.deadline - started))
                    if not renewed:
                        run = await self.journal.run(body.run_id, intent.buyer_id)
                        entry.reason = "stop" if run["stopRequested"] else "restart"
                        raise JournalLeaseLost("运行日志租约失效或收到跨实例停止请求")
                    entry.deadline = started + self.lease_seconds
                except Exception:
                    entry.valid = False
                    if entry.task:
                        entry.task.cancel()
                    return

        writer = asyncio.create_task(write_events())
        lease_task = asyncio.create_task(heartbeat())
        adapter.start()
        try:
            if self.confirmations is not None:
                saved = await self.confirmations.list(intent.buyer_id, intent.shopping_session_id)
                adapter.state["confirmations"] = saved["confirmations"]
                adapter.snapshot()
            cache_ticket = None
            if self.structured_cache is not None:
                cache_started = time.perf_counter()
                decision = await self.orchestrator.prepare_structured_cache(
                    intent,
                    # 客户端带历史时只会导致保守旁路；不会扩大缓存命中范围。
                    has_history=len(body.messages) > 1,
                )
                cache_ticket = decision.ticket
                cache_outcome = decision.outcome
                if cache_ticket is not None:
                    try:
                        hit = await self.structured_cache.lookup(cache_ticket, intent.raw_query)
                        cache_outcome = "hit" if hit is not None else "miss"
                    except Exception as err:  # noqa: BLE001 —— 缓存永远不能阻断页面主链路
                        logger.warning("AG-UI 结构化缓存查询失败，回源 Agent：%s", type(err).__name__)
                        hit = None
                        cache_outcome = "error"
                    self.cache_metrics.observe(
                        cache_outcome,
                        latency_ms=(time.perf_counter() - cache_started) * 1000,
                    )
                    if hit is not None:
                        adapter.replay_cached(
                            hit.response,
                            similarity=hit.similarity,
                            matched_query=hit.matched_query,
                        )
                        return
                else:
                    self.cache_metrics.observe(
                        cache_outcome,
                        latency_ms=(time.perf_counter() - cache_started) * 1000,
                    )
            with observe_run_events(adapter.on_trade_event):
                result = await self.orchestrator.handle_intent(intent, event_observer=adapter.on_agent_event,
                    use_semantic_cache=False, persistence_guard=entry.is_valid)
            if not entry.is_valid():
                raise asyncio.CancelledError()
            if result.error or adapter.error:
                adapter.fail(adapter.error or "本轮服务暂时未能完成请求，请重试。")
            else:
                adapter.finish(result.final_text)
                if cache_ticket is not None:
                    response = AGUICachedResponse.from_runtime(result.final_text, adapter.state)
                    try:
                        await self.structured_cache.remember(cache_ticket, intent.raw_query, response)
                    except Exception as err:  # noqa: BLE001
                        logger.warning("AG-UI 结构化缓存写入失败，忽略：%s", type(err).__name__)
        except asyncio.CancelledError:
            adapter.fail("本轮已明确停止" if entry.reason == "stop" else "服务重启或执行中断，已保存的内容仍可恢复。", cancelled=entry.reason == "stop")
        except Exception:
            logger.exception("AG-UI 运行失败：%s", body.run_id)
            adapter.fail("本轮服务暂时未能完成请求，请重试。")
        finally:
            lease_task.cancel()
            await asyncio.gather(lease_task, return_exceptions=True)
            queue.put_nowait(None)
            try:
                await writer
            except Exception:
                logger.exception("AG-UI 日志写入失败，等待持久租约过期后标记中断：%s", body.run_id)
            entry.valid = False
            self.running.pop(body.run_id, None)
