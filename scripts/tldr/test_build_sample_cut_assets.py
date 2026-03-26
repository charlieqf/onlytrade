import json
from pathlib import Path

import pytest

from scripts.tldr.build_sample_cut_assets import (
    AssetBuildContext,
    build_sample_cut_assets,
    create_asset_context,
)


def _write_topic_json(
    topic_dir: Path, *, topic_key: str = "anthropic_harness_design"
) -> None:
    topic_dir.mkdir(parents=True, exist_ok=True)
    (topic_dir / "topic.json").write_text(
        json.dumps(
            {
                "topic_id": "tldr_test_topic",
                "topic_key": topic_key,
                "title_en": "Test topic",
                "source_url": "https://example.com/article",
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def test_create_asset_context_uses_topic_and_version_paths(tmp_path: Path) -> None:
    root_dir = tmp_path
    topic_dir = root_dir / "data/live/onlytrade/tldr_workspace/2026-03-26/01_test_topic"
    _write_topic_json(topic_dir)

    context = create_asset_context(
        topic_dir,
        version="v1",
        root_dir=root_dir,
        public_slug="anthropic-harness",
    )

    assert context.archive_dir == topic_dir / "sample_cut_v1_assets"
    assert context.manifest_path == topic_dir / "sample_cut_v1_asset_manifest.json"
    assert (
        context.public_dir
        == root_dir / "content-factory-renderer/public/tldr-sample/anthropic-harness-v1"
    )


def test_build_sample_cut_assets_runs_profile_and_writes_manifest(
    tmp_path: Path,
) -> None:
    root_dir = tmp_path
    topic_dir = root_dir / "data/live/onlytrade/tldr_workspace/2026-03-26/01_test_topic"
    _write_topic_json(topic_dir)
    recording_dir = topic_dir / "recording"
    recording_dir.mkdir(parents=True)
    (recording_dir / "video.mp4").write_bytes(b"fake-video")
    assets_dir = topic_dir / "assets"
    assets_dir.mkdir(parents=True)
    (assets_dir / "hero.png").write_bytes(b"hero")

    called: list[AssetBuildContext] = []

    def fake_profile(context: AssetBuildContext) -> dict:
        called.append(context)
        context.copy_asset("hero.png", "hero-copy.png")
        (context.archive_dir / "helper-card.jpg").write_bytes(b"helper")
        (context.public_dir / "helper-card.jpg").write_bytes(b"helper")
        return {
            "renderer_assets": [
                "tldr-sample/anthropic-harness-v1/hero-copy.png",
                "tldr-sample/anthropic-harness-v1/helper-card.jpg",
            ],
            "archived_assets": [
                "data/live/onlytrade/tldr_workspace/2026-03-26/01_test_topic/sample_cut_v1_assets/hero-copy.png",
                "data/live/onlytrade/tldr_workspace/2026-03-26/01_test_topic/sample_cut_v1_assets/helper-card.jpg",
            ],
        }

    result = build_sample_cut_assets(
        topic_dir,
        version="v1",
        root_dir=root_dir,
        profiles={
            "anthropic_harness_design": {
                "public_slug": "anthropic-harness",
                "builder": fake_profile,
            }
        },
    )

    assert len(called) == 1
    assert result["recording_ready"] is True
    assert (topic_dir / "sample_cut_v1_assets" / "hero-copy.png").exists()
    assert (topic_dir / "sample_cut_v1_assets" / "helper-card.jpg").exists()
    assert (
        root_dir
        / "content-factory-renderer/public/tldr-sample/anthropic-harness-v1/hero-copy.png"
    ).exists()
    manifest = json.loads(
        (topic_dir / "sample_cut_v1_asset_manifest.json").read_text(encoding="utf-8")
    )
    assert manifest["topic"] == "anthropic_harness_design"
    assert manifest["expected_source_video"].endswith("recording/video.mp4")
    assert manifest["renderer_assets"][0].endswith("hero-copy.png")


def test_build_sample_cut_assets_requires_known_topic_profile(tmp_path: Path) -> None:
    topic_dir = tmp_path / "01_unknown_topic"
    _write_topic_json(topic_dir, topic_key="unknown_topic")

    with pytest.raises(KeyError, match="unknown_topic"):
        build_sample_cut_assets(topic_dir, version="v1", root_dir=tmp_path, profiles={})
