import subprocess
import sys
from pathlib import Path

from scripts.topic_stream import run_market_radar_lab_cycle as radar


def test_market_radar_lab_cycle_script_help_runs_from_repo_root() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    script_path = (
        repo_root / "scripts" / "topic_stream" / "run_market_radar_lab_cycle.py"
    )
    result = subprocess.run(
        [sys.executable, str(script_path), "--help"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "--output" in result.stdout


def test_market_radar_lab_prompt_demands_punchy_opening() -> None:
    prompt = radar.base._commentary_user_prompt(
        {"label": "ByteDance", "sector": "tech"},
        {
            "title": "火山引擎上线 ArkClaw",
            "summary": "推出云上 SaaS 版 OpenClaw",
            "source": "ITHome",
        },
    )
    assert "第一段第一句必须是开场炸点" in prompt
    assert "不要像资讯总结或行业周报" in prompt
    assert "禁止使用 表面上看 / 先把事实摆清楚 / 真正值得看的" in prompt


def test_market_radar_lab_fallback_is_hotter_and_has_hook() -> None:
    block = radar.base._fallback_commentary(
        {"label": "ByteDance"},
        {
            "title": "火山引擎上线 ArkClaw",
            "summary": "推出云上 SaaS 版 OpenClaw，并开放试用",
        },
    )
    assert "先别划走" in block["commentary_script"]
    assert "我的判断很直接" in block["commentary_script"]
    assert "接下来要看" in block["commentary_script"]
