# -*- coding: utf-8 -*-
"""品类召回 runner 的 profile/选集校验应可在无 AgentScope 时运行。"""
import subprocess
import sys


def test_category_runner_profile_imports_without_agentscope():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from scripts.eval.run_category_recall import formal_thresholds; "
            "assert formal_thresholds().recall == 0.85",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
