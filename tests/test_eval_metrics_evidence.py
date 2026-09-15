from scripts.eval.metrics_evidence import collect_case_metrics, release_metrics


def test_no_service_usage_does_not_become_zero_cost_or_publishable_metrics():
    metrics = collect_case_metrics([], expected_turns=2, elapsed_ms=100)
    assert metrics['input_tokens'] is None and metrics['cost_usd'] is None
    result = release_metrics([{'metrics': metrics, 'verdict': 'PASS', 'p0_pass': True}])
    assert result['task_success_rate'] == 1
    assert result['latency_p95_ms'] == 100
    assert result['input_tokens'] is None


def test_every_dialogue_turn_requires_real_complete_usage():
    event = {'type': 'usage.summary', 'payload': {'usage_complete': True, 'input_tokens': 10, 'output_tokens': 4, 'cost_usd': None}}
    assert collect_case_metrics([event], expected_turns=2, elapsed_ms=100)['input_tokens'] is None
    metrics = collect_case_metrics([event, event], expected_turns=2, elapsed_ms=100)
    assert metrics['input_tokens'] == 20 and metrics['cost_usd'] is None
    result = release_metrics([{'metrics': metrics, 'verdict': 'FAIL', 'p0_pass': True}])
    assert result['input_tokens'] == 20 and result['task_success_rate'] == 0


def test_release_metrics_reports_cache_rate_and_wilson_interval():
    event = {
        'type': 'usage.summary',
        'payload': {'usage_complete': True, 'input_tokens': 10, 'output_tokens': 4, 'cost_usd': None},
    }
    hit = {'type': 'cache.lookup', 'payload': {'outcome': 'hit'}}
    miss = {'type': 'cache.lookup', 'payload': {'outcome': 'miss'}}
    metrics = collect_case_metrics([event, hit, miss], expected_turns=1, elapsed_ms=100)
    result = release_metrics([{'metrics': metrics, 'verdict': 'PASS', 'p0_pass': True}])
    assert result['cache_hit_rate'] == 0.5
    assert result['cache_eligible_lookups'] == 2
    assert result['task_success_rate_ci95'][0] < 1
    assert result['task_success_rate_ci95'][1] <= 1


def test_case_metrics_contains_low_sensitivity_tool_latency_and_usage_breakdown():
    event = {
        'type': 'tool.telemetry',
        'payload': {
            'phase': 'finish', 'tool': 'product_search_tool', 'tool_call_id': 'tc-1',
            'status': 'success', 'elapsed_ms': 125, 'input_tokens': 40, 'output_tokens': 8,
        },
    }
    metrics = collect_case_metrics([event], expected_turns=0, elapsed_ms=200)
    tool = metrics['tool_metrics']['product_search_tool']
    assert tool['calls'] == 1
    assert tool['p95_ms'] == 125
    assert tool['input_tokens'] == 40
    assert tool['output_tokens'] == 8
