import json
from pathlib import Path

from scripts.tldr.build_post_recording_package import build_post_recording_package


def _write_topic_json(topic_dir: Path) -> None:
    topic_dir.mkdir(parents=True, exist_ok=True)
    (topic_dir / "topic.json").write_text(
        json.dumps(
            {
                "topic_id": "tldr_test_topic_20260330",
                "topic_key": "turboquant_random_rotation",
                "screen_title_cn": "TurboQuant让长上下文更便宜",
                "title_en": "TurboQuant makes long context cheaper",
                "source_links": [
                    {
                        "label": "Google Research",
                        "url": "https://research.google/blog/turboquant-redefining-ai-efficiency-with-extreme-compression/",
                    }
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def _sample_transcript() -> dict:
    return {
        "source": "recording/video.mp4",
        "model": "small",
        "language": "zh",
        "segments": [
            {
                "id": 0,
                "start": 1.0,
                "end": 4.0,
                "text": "先说结论，TurboQuant 可以让长上下文更便宜。",
            },
            {
                "id": 1,
                "start": 4.0,
                "end": 8.0,
                "text": "它主要压缩的是推理时最占空间的 KV cache。",
            },
            {
                "id": 2,
                "start": 8.0,
                "end": 13.0,
                "text": "关键动作是先随机旋转，再进行低比特量化。",
            },
        ],
    }


def test_build_post_recording_package_creates_subtitles_cut_plan_and_render_props(
    tmp_path: Path,
) -> None:
    root_dir = tmp_path
    topic_dir = root_dir / "data/live/onlytrade/tldr_workspace/2026-03-30/01_test_topic"
    _write_topic_json(topic_dir)
    recording_dir = topic_dir / "recording"
    recording_dir.mkdir(parents=True)
    (recording_dir / "video.mp4").write_bytes(b"fake-video")
    assets_dir = topic_dir / "sample_cut_v1_assets"
    assets_dir.mkdir(parents=True)
    (assets_dir / "source-google-blog-page.png").write_bytes(b"png")
    (topic_dir / "sample_cut_v1_asset_manifest.json").write_text(
        json.dumps(
            {
                "recommended_primary_assets": [
                    {
                        "path": "sample_cut_v1_assets/source-google-blog-page.png",
                        "role": "source",
                        "spoken_section": "opening claim",
                    }
                ]
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    result = build_post_recording_package(
        topic_dir,
        root_dir=root_dir,
        transcribe_fn=lambda _path: _sample_transcript(),
    )

    assert (recording_dir / "video.stt.verbose.json").exists()
    assert (recording_dir / "video.stt.txt").exists()
    assert (recording_dir / "video.stt.cleaned.md").exists()
    assert (recording_dir / "video.subtitle.cues.json").exists()
    assert (recording_dir / "video.cut-plan.md").exists()
    assert (topic_dir / "sample_cut_v1" / "sample_cut_v1_render_props.json").exists()
    assert result["duration_in_seconds"] == 13.0
    assert result["cutaway_count"] == 1

    props = json.loads(
        (topic_dir / "sample_cut_v1" / "sample_cut_v1_render_props.json").read_text(
            encoding="utf-8"
        )
    )
    assert props["videoSrc"].endswith("aroll-video.mp4")
    assert props["sourceLabel"] == "Google Research"
    assert props["headline"] == "TurboQuant让长上下文更便宜"
    assert len(props["subtitleCues"]) == 3
    assert len(props["cutaways"]) == 1

    public_dir = (
        root_dir
        / "content-factory-renderer/public/tldr-sample/turboquant-random-rotation-v1"
    )
    assert (public_dir / "aroll-video.mp4").exists()
    assert (public_dir / "source-google-blog-page.png").exists()


def test_build_post_recording_package_falls_back_to_source_asset_manifest(
    tmp_path: Path,
) -> None:
    root_dir = tmp_path
    topic_dir = root_dir / "data/live/onlytrade/tldr_workspace/2026-03-30/02_test_topic"
    _write_topic_json(topic_dir)
    recording_dir = topic_dir / "recording"
    recording_dir.mkdir(parents=True)
    (recording_dir / "video.mp4").write_bytes(b"fake-video")
    assets_dir = topic_dir / "sample_cut_v1_assets"
    assets_dir.mkdir(parents=True)
    (assets_dir / "source-001.png").write_bytes(b"png")
    source_manifest_dir = topic_dir / "assets"
    source_manifest_dir.mkdir(parents=True)
    (source_manifest_dir / "source_asset_manifest.json").write_text(
        json.dumps(
            {
                "archived_assets": ["sample_cut_v1_assets/source-001.png"],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    result = build_post_recording_package(
        topic_dir,
        root_dir=root_dir,
        transcribe_fn=lambda _path: _sample_transcript(),
    )

    assert result["cutaway_count"] == 1


def test_build_post_recording_package_uses_cleaned_transcript_text_for_subtitles(
    tmp_path: Path,
) -> None:
    root_dir = tmp_path
    topic_dir = root_dir / "data/live/onlytrade/tldr_workspace/2026-03-30/03_test_topic"
    _write_topic_json(topic_dir)
    recording_dir = topic_dir / "recording"
    recording_dir.mkdir(parents=True)
    (recording_dir / "video.mp4").write_bytes(b"fake-video")
    (recording_dir / "video.stt.cleaned.md").write_text(
        "清洗后第一句。\n\n清洗后第二句。\n\n清洗后第三句。\n",
        encoding="utf-8",
    )

    build_post_recording_package(
        topic_dir,
        root_dir=root_dir,
        transcribe_fn=lambda _path: _sample_transcript(),
    )

    subtitle_cues = json.loads(
        (recording_dir / "video.subtitle.cues.json").read_text(encoding="utf-8")
    )
    assert [cue["text"] for cue in subtitle_cues] == [
        "清洗后第一句。",
        "清洗后第二句。",
        "清洗后第三句。",
    ]


def test_build_post_recording_package_supports_audio_only_recordings(
    tmp_path: Path,
) -> None:
    root_dir = tmp_path
    topic_dir = root_dir / "data/live/onlytrade/tldr_workspace/2026-03-30/04_test_topic"
    _write_topic_json(topic_dir)
    recording_dir = topic_dir / "recording"
    recording_dir.mkdir(parents=True)
    (recording_dir / "audio.mp3").write_bytes(b"fake-audio")
    assets_dir = topic_dir / "sample_cut_v1_assets"
    assets_dir.mkdir(parents=True)
    (assets_dir / "card-001.jpg").write_bytes(b"jpg")
    (topic_dir / "sample_cut_v1_asset_manifest.json").write_text(
        json.dumps(
            {
                "recommended_primary_assets": [
                    {
                        "path": "sample_cut_v1_assets/card-001.jpg",
                        "role": "卡片",
                        "spoken_section": "opening claim",
                    }
                ]
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    result = build_post_recording_package(
        topic_dir,
        root_dir=root_dir,
        transcribe_fn=lambda _path: _sample_transcript(),
    )

    props = json.loads(
        (topic_dir / "sample_cut_v1" / "sample_cut_v1_render_props.json").read_text(
            encoding="utf-8"
        )
    )
    public_dir = (
        root_dir
        / "content-factory-renderer/public/tldr-sample/turboquant-random-rotation-v1"
    )

    assert result["cutaway_count"] == 1
    assert props["audioSrc"].endswith("audio-bed.mp3")
    assert props["videoSrc"] is None
    assert (public_dir / "audio-bed.mp3").exists()
    assert (public_dir / "card-001.jpg").exists()


def test_build_post_recording_package_reuses_existing_verbose_transcript(
    tmp_path: Path,
) -> None:
    root_dir = tmp_path
    topic_dir = root_dir / "data/live/onlytrade/tldr_workspace/2026-03-30/05_test_topic"
    _write_topic_json(topic_dir)
    recording_dir = topic_dir / "recording"
    recording_dir.mkdir(parents=True)
    (recording_dir / "audio.mp3").write_bytes(b"fake-audio")
    (recording_dir / "video.stt.verbose.json").write_text(
        json.dumps(_sample_transcript(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    assets_dir = topic_dir / "sample_cut_v1_assets"
    assets_dir.mkdir(parents=True)
    (assets_dir / "card-001.jpg").write_bytes(b"jpg")
    (topic_dir / "sample_cut_v1_asset_manifest.json").write_text(
        json.dumps(
            {
                "recommended_primary_assets": [
                    {
                        "path": "sample_cut_v1_assets/card-001.jpg",
                        "role": "卡片",
                        "spoken_section": "opening claim",
                    }
                ]
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    build_post_recording_package(
        topic_dir,
        root_dir=root_dir,
        transcribe_fn=lambda _path: (_ for _ in ()).throw(
            AssertionError("should not transcribe twice")
        ),
    )

    props = json.loads(
        (topic_dir / "sample_cut_v1" / "sample_cut_v1_render_props.json").read_text(
            encoding="utf-8"
        )
    )
    assert len(props["subtitleCues"]) == 3
