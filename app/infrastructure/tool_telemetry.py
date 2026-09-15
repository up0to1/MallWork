# -*- coding: utf-8 -*-
"""统一工具调用遥测中间件。

它只记录低基数的工具名、调用 ID、状态、耗时和结果数量，不记录参数和返回正文。
``tool_scope`` 让 task_dispatch 内部的 worker 模型 usage 能够关联到父工具调用。
"""
from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Callable

from agentscope.message import ToolResultState
from agentscope.tool import ToolBase, ToolChunk, ToolMiddlewareBase

from app.infrastructure.context import ShoppingContext
from app.infrastructure.eventbus import TradeEventBus
from app.infrastructure.operational_metrics import tool_scope


class ToolTelemetryMiddleware(ToolMiddlewareBase):
    """为每次工具执行建立可回放的低敏遥测记录。"""

    def __init__(self, bus: TradeEventBus, *, agent_name: str = "") -> None:
        self._bus = bus
        self._agent_name = agent_name

    @staticmethod
    def _status(chunks: list[ToolChunk]) -> str:
        if any(getattr(chunk, "state", None) == ToolResultState.ERROR for chunk in chunks):
            return "error"
        return "success"

    @staticmethod
    def _result_count(chunks: list[ToolChunk]) -> int | None:
        if not chunks:
            return 0
        last = chunks[-1]
        count = 0
        for block in getattr(last, "content", []) or []:
            text = getattr(block, "text", None)
            if isinstance(text, str) and text:
                count += 1
        return count

    def _publish(self, session_id: str, payload: dict[str, Any]) -> None:
        self._bus.publish(session_id, "tool.telemetry", payload)

    async def on_tool_call(
        self,
        tool: ToolBase,
        input_kwargs: dict[str, Any],
        next_handler: Callable[..., AsyncGenerator[ToolChunk, None]],
    ) -> AsyncGenerator[ToolChunk, None]:
        session_id = ShoppingContext.current_session_id()
        tool_call_id = f"tc_{uuid.uuid4().hex}"
        started = time.perf_counter()
        started_at = datetime.now(timezone.utc).isoformat()
        self._publish(session_id, {
            "phase": "start",
            "tool": tool.name,
            "tool_call_id": tool_call_id,
            "agent": self._agent_name,
            "started_at": started_at,
        })

        chunks: list[ToolChunk] = []
        status = "success"
        error_type = None
        try:
            with tool_scope(tool_call_id, tool.name):
                async for chunk in next_handler(**input_kwargs):
                    chunks.append(chunk)
            status = self._status(chunks)
            if status != "success":
                error_type = "tool_result_error"
        except asyncio.TimeoutError:
            status, error_type = "timeout", "TimeoutError"
            raise
        except asyncio.CancelledError:
            status, error_type = "error", "CancelledError"
            raise
        except Exception as error:  # noqa: BLE001 —— 不改变下游异常语义
            status, error_type = "error", type(error).__name__
            raise
        finally:
            self._publish(session_id, {
                "phase": "finish",
                "tool": tool.name,
                "tool_call_id": tool_call_id,
                "agent": self._agent_name,
                "status": status,
                "error_type": error_type,
                "elapsed_ms": round((time.perf_counter() - started) * 1000, 3),
                "result_count": self._result_count(chunks),
                "finished_at": datetime.now(timezone.utc).isoformat(),
            })

        for chunk in chunks:
            yield chunk
