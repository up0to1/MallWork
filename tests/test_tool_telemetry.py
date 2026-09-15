# -*- coding: utf-8 -*-
from app.infrastructure import operational_metrics as metrics
from app.infrastructure.operational_metrics import MetricsRegistry, tool_scope


async def _collect(result):
    if hasattr(result, "__aiter__"):
        return [item async for item in result]
    return [result]


def test_tool_telemetry_aggregates_latency_errors_and_associated_tokens():
    registry = MetricsRegistry(window_size=10)
    registry.record_tool({
        "tool": "product_search_tool",
        "tool_call_id": "tc-1",
        "status": "success",
        "elapsed_ms": 120,
        "input_tokens": 30,
        "output_tokens": 10,
    })
    registry.record_tool({
        "tool": "product_search_tool",
        "tool_call_id": "tc-2",
        "status": "error",
        "elapsed_ms": 240,
        "input_tokens": 20,
        "output_tokens": 5,
    })

    summary = registry.snapshot()["tools"]["product_search_tool"]

    assert summary["calls"] == 2
    assert summary["errors"] == 1
    assert summary["error_rate"] == 0.5
    assert summary["p50_ms"] == 120
    assert summary["p95_ms"] == 240
    assert summary["input_tokens"] == 50
    assert summary["output_tokens"] == 15


def test_model_usage_inside_tool_scope_is_attached_to_completed_tool(monkeypatch):
    registry = MetricsRegistry(window_size=10)
    monkeypatch.setattr(metrics, "registry", registry)
    observation = metrics.begin_request()
    with tool_scope("tc-dispatch", "task_dispatch"):
        metrics.observe_model(input_tokens=70, output_tokens=11)
    metrics.finish_request(observation)
    registry.record_tool({
        "tool": "task_dispatch",
        "tool_call_id": "tc-dispatch",
        "status": "success",
        "elapsed_ms": 300,
    })
    summary = registry.snapshot()["tools"]["task_dispatch"]
    assert summary["input_tokens"] == 70
    assert summary["output_tokens"] == 11
    assert summary["usage_complete"] is True


def test_usage_after_nested_tool_is_attached_to_the_latest_tool(monkeypatch):
    registry = MetricsRegistry(window_size=10)
    monkeypatch.setattr(metrics, "registry", registry)
    observation = metrics.begin_request()
    with tool_scope("tc-parent", "task_dispatch"):
        metrics.observe_model(input_tokens=10, output_tokens=2)
        with tool_scope("tc-child", "product_search_tool"):
            pass
        metrics.observe_model(input_tokens=30, output_tokens=4)
    metrics.finish_request(observation)
    registry.record_tool({"tool": "task_dispatch", "tool_call_id": "tc-parent", "status": "success", "elapsed_ms": 1})
    registry.record_tool({"tool": "product_search_tool", "tool_call_id": "tc-child", "status": "success", "elapsed_ms": 1})
    assert registry.snapshot()["tools"]["task_dispatch"]["input_tokens"] == 10
    assert registry.snapshot()["tools"]["product_search_tool"]["input_tokens"] == 30


def test_usage_after_outer_tool_scope_is_not_attributed_to_previous_tool(monkeypatch):
    registry = MetricsRegistry(window_size=10)
    monkeypatch.setattr(metrics, "registry", registry)
    observation = metrics.begin_request()
    with tool_scope("tc-parent", "task_dispatch"):
        metrics.observe_model(input_tokens=10, output_tokens=2)
    metrics.observe_model(input_tokens=30, output_tokens=4)
    metrics.finish_request(observation)
    registry.record_tool({"tool": "task_dispatch", "tool_call_id": "tc-parent", "status": "success", "elapsed_ms": 1})
    assert registry.snapshot()["tools"]["task_dispatch"]["input_tokens"] == 10


async def test_middleware_emits_start_and_finish_without_recording_arguments():
    from agentscope.message import TextBlock, ToolResultState
    from agentscope.tool import FunctionTool, ToolChunk
    from app.infrastructure.context import ShoppingContext, ShoppingContextSnapshot
    from app.infrastructure.eventbus import TradeEventBus
    from app.infrastructure.tool_telemetry import ToolTelemetryMiddleware

    async def tool_func(secret: str = "") -> ToolChunk:
        return ToolChunk(content=[TextBlock(type="text", text="ok")], state=ToolResultState.SUCCESS)

    bus = TradeEventBus()
    queue = bus.subscribe("telemetry-session")
    tool = FunctionTool(
        tool_func,
        middlewares=[ToolTelemetryMiddleware(bus, agent_name="test_agent")],
    )
    token = ShoppingContext.set(ShoppingContextSnapshot(
        shopping_session_id="telemetry-session", buyer_id="b1", locale="zh-CN", currency="CNY",
    ))
    try:
        await _collect(await tool(secret="do-not-log"))
    finally:
        ShoppingContext.reset(token)

    events = []
    while not queue.empty():
        events.append(queue.get_nowait())
    telemetry = [event.payload for event in events if event.type == "tool.telemetry"]
    assert [payload["phase"] for payload in telemetry] == ["start", "finish"]
    assert telemetry[0]["tool_call_id"] == telemetry[1]["tool_call_id"]
    assert "secret" not in str(telemetry)
