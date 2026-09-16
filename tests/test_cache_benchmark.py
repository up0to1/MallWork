from scripts.eval.cache_benchmark import default_dataset, summarize


def test_default_dataset_has_twenty_topics_and_one_plus_four_queries_each():
    dataset = default_dataset()
    assert len(dataset) == 20
    assert len({row["id"] for row in dataset}) == 20
    assert all(len(row["variants"]) == 4 for row in dataset)
    assert sum(1 + len(row["variants"]) for row in dataset) == 100


def test_summary_gates_hit_consistency_bypass_and_zero_model_path():
    eligible = []
    for topic in range(20):
        eligible.append({
            "case_id": f"t{topic}-seed", "kind": "seed", "cache_hit": False,
            "replay_consistent": None, "agent_path_events": 3, "seed_valid": True,
        })
        for variant in range(4):
            eligible.append({
                "case_id": f"t{topic}-v{variant}", "kind": "variant", "cache_hit": True,
                "replay_consistent": True, "agent_path_events": 0, "seed_valid": True,
            })
    controls = [
        {"case_id": "history-1", "kind": "control", "cache_hit": False, "expected_bypass": True},
        {"case_id": "unsafe-1", "kind": "control", "cache_hit": False, "expected_bypass": True},
    ]

    report = summarize([*eligible, *controls])

    assert report["eligible_lookups"] == 100
    assert report["hits"] == 80
    assert report["hit_rate"] == 0.8
    assert report["replay_consistency"] == 1.0
    assert report["bypass_accuracy"] == 1.0
    assert report["false_hits"] == 0
    assert report["agent_path_events_on_hits"] == 0
    assert report["gate"] == "PASS"


def test_summary_blocks_false_hit_or_agent_path_on_hit():
    rows = [{
        "case_id": "seed", "kind": "seed", "cache_hit": False,
        "replay_consistent": None, "agent_path_events": 2, "seed_valid": True,
    }]
    rows.extend({
        "case_id": f"v{i}", "kind": "variant", "cache_hit": True,
        "replay_consistent": i != 0, "agent_path_events": int(i == 1), "seed_valid": True,
    } for i in range(4))

    report = summarize(rows)

    assert report["false_hits"] == 1
    assert report["agent_path_events_on_hits"] == 1
    assert report["gate"] == "BLOCK"
