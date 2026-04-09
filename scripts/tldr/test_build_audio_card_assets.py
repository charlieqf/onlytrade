import json
from pathlib import Path

from scripts.tldr.build_audio_card_assets import build_audio_card_assets


def _write_topic_json(topic_dir: Path) -> None:
    topic_dir.mkdir(parents=True, exist_ok=True)
    (topic_dir / "topic.json").write_text(
        json.dumps(
            {
                "topic_id": "audio_card_test_topic",
                "topic_key": "audio_card_test_topic",
                "screen_title_cn": "AI 找漏洞开始逼行业联防",
                "source_links": [{"label": "Local", "url": "file:///tmp/local-source"}],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def test_build_audio_card_assets_creates_cards_and_manifest(tmp_path: Path) -> None:
    topic_dir = (
        tmp_path / "data/live/onlytrade/tldr_workspace/2026-04-09/01_audio_topic"
    )
    _write_topic_json(topic_dir)
    recording_dir = topic_dir / "recording"
    recording_dir.mkdir(parents=True)
    (recording_dir / "audio.mp3").write_bytes(b"fake-audio")
    (recording_dir / "video.stt.cleaned.md").write_text(
        "今天来聊一下 AI 找漏洞\n\n它已经逼得行业提前联防\n\n数千个高严重度漏洞\n\n最后看的是窗口期\n",
        encoding="utf-8",
    )

    result = build_audio_card_assets(topic_dir, version="v1")

    manifest_path = topic_dir / "sample_cut_v1_asset_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    archive_dir = topic_dir / "sample_cut_v1_assets"

    assert result["card_count"] >= 3
    assert manifest["recording_ready"] is True
    assert len(manifest["recommended_primary_assets"]) >= 3
    assert (archive_dir / "card-001.jpg").exists()
    assert (archive_dir / "card-002.jpg").exists()


def test_build_audio_card_assets_uses_llm_card_plan_when_present(
    tmp_path: Path,
) -> None:
    topic_dir = (
        tmp_path / "data/live/onlytrade/tldr_workspace/2026-04-09/02_audio_topic"
    )
    _write_topic_json(topic_dir)
    recording_dir = topic_dir / "recording"
    recording_dir.mkdir(parents=True)
    (recording_dir / "audio.mp3").write_bytes(b"fake-audio")
    (recording_dir / "video.stt.cleaned.md").write_text(
        "原始第一句\n\n原始第二句\n",
        encoding="utf-8",
    )
    (recording_dir / "video.card-plan.json").write_text(
        json.dumps(
            {
                "headline": "LLM 清洗后的标题",
                "cards": [
                    {
                        "label": "开场卡",
                        "headline": "先讲核心结论",
                        "lines": ["第一点", "第二点", "第三点"],
                    },
                    {
                        "label": "收束卡",
                        "headline": "再讲执行动作",
                        "lines": ["动作一", "动作二"],
                    },
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    result = build_audio_card_assets(topic_dir, version="v1")

    manifest = json.loads(
        (topic_dir / "sample_cut_v1_asset_manifest.json").read_text(encoding="utf-8")
    )

    assert result["headline"] == "LLM 清洗后的标题"
    assert result["card_count"] == 2
    assert manifest["recommended_primary_assets"][0]["spoken_section"] == "开场卡"
