from pathlib import Path

import scripts.content_factory.render_publish_t022_from_packages as publish
from scripts.content_factory.retained_video_manifest_merge import (
    _parse_published_at,
    merge_retained_segments,
)


def _row(topic_id: str, published_at: str, video_file: str) -> dict:
    return {
        "id": topic_id,
        "topic_id": topic_id,
        "published_at": published_at,
        "video_file": video_file,
        "poster_file": video_file.replace(".mp4", ".jpg"),
    }


def test_merge_retains_latest_twenty_segments_by_topic_id() -> None:
    existing = {
        "room_id": "t_022",
        "program_slug": "china-bigtech",
        "segments": [
            _row(f"topic_{i:02d}", f"2026-03-21T00:{i:02d}:00Z", f"segment_{i:02d}.mp4")
            for i in range(25)
        ],
    }

    merged = merge_retained_segments(
        existing,
        {"room_id": "t_022", "program_slug": "china-bigtech", "segments": []},
        retain_limit=20,
    )

    assert merged["segment_count"] == 20
    assert [row["topic_id"] for row in merged["segments"]] == [
        f"topic_{i:02d}" for i in range(24, 4, -1)
    ]


def test_merge_prefers_newer_segment_for_same_topic_id() -> None:
    existing = {
        "room_id": "t_022",
        "program_slug": "china-bigtech",
        "segments": [
            {
                **_row("topic_x", "2026-03-21T04:00:00Z", "old.mp4"),
                "title": "old render",
            }
        ],
    }
    incoming = {
        "room_id": "t_022",
        "program_slug": "china-bigtech",
        "segments": [
            {
                **_row("topic_x", "2026-03-21T05:00:00Z", "new.mp4"),
                "title": "new render",
            }
        ],
    }

    merged = merge_retained_segments(existing, incoming, retain_limit=20)

    assert [row["topic_id"] for row in merged["segments"]] == ["topic_x"]
    assert merged["segment_count"] == 1
    assert merged["segments"][0]["title"] == "new render"
    assert merged["segments"][0]["video_file"] == "new.mp4"


def test_merge_keeps_newer_retained_segment_when_incoming_is_older() -> None:
    existing = {
        "room_id": "t_022",
        "program_slug": "china-bigtech",
        "segments": [
            {
                **_row("topic_x", "2026-03-21T05:00:00Z", "newer.mp4"),
                "title": "newer retained render",
            }
        ],
    }
    incoming = {
        "room_id": "t_022",
        "program_slug": "china-bigtech",
        "segments": [
            {
                **_row("topic_x", "2026-03-21T04:00:00Z", "older.mp4"),
                "title": "older incoming render",
            }
        ],
    }

    merged = merge_retained_segments(existing, incoming, retain_limit=20)

    assert [row["topic_id"] for row in merged["segments"]] == ["topic_x"]
    assert merged["segment_count"] == 1
    assert merged["segments"][0]["title"] == "newer retained render"
    assert merged["segments"][0]["video_file"] == "newer.mp4"


def test_parse_published_at_supports_rfc2822_and_space_separated_offsets() -> None:
    rfc = _parse_published_at("Mon, 23 Mar 2026 08:00:18 GMT")
    offset = _parse_published_at("2026-03-23 16:10:41 +0800")

    assert rfc is not None
    assert offset is not None
    assert rfc.isoformat() == "2026-03-23T08:00:18+00:00"
    assert offset.isoformat() == "2026-03-23T08:10:41+00:00"


def test_merge_promotes_new_rfc2822_segments_ahead_of_older_retained_rows() -> None:
    existing = {
        "room_id": "t_022",
        "program_slug": "china-bigtech",
        "segments": [
            _row("topic_old_a", "Fri, 20 Mar 2026 14:54:19 GMT", "old-a.mp4"),
            _row("topic_old_b", "Sat, 21 Mar 2026 04:22:58 GMT", "old-b.mp4"),
        ],
    }
    incoming = {
        "room_id": "t_022",
        "program_slug": "china-bigtech",
        "segments": [
            _row("topic_new", "Mon, 23 Mar 2026 08:00:18 GMT", "new.mp4"),
        ],
    }

    merged = merge_retained_segments(existing, incoming, retain_limit=20)

    assert [row["topic_id"] for row in merged["segments"][:3]] == [
        "topic_new",
        "topic_old_b",
        "topic_old_a",
    ]


def test_merge_drops_rows_with_missing_video_file_when_asset_filtering_enabled(
    tmp_path: Path,
) -> None:
    video_dir = tmp_path / "videos"
    poster_dir = tmp_path / "posters"
    video_dir.mkdir()
    poster_dir.mkdir()
    (video_dir / "keep.mp4").write_text("video", encoding="utf-8")
    (poster_dir / "keep.jpg").write_text("poster", encoding="utf-8")

    merged = merge_retained_segments(
        {"room_id": "t_022", "program_slug": "china-bigtech", "segments": []},
        {
            "room_id": "t_022",
            "program_slug": "china-bigtech",
            "segments": [
                _row("keep", "2026-03-21T05:00:00Z", "keep.mp4"),
                _row("drop", "2026-03-21T04:00:00Z", "missing.mp4"),
            ],
        },
        retain_limit=20,
        video_dir=video_dir,
        poster_dir=poster_dir,
    )

    assert [row["topic_id"] for row in merged["segments"]] == ["keep"]
    assert merged["segment_count"] == 1


def test_render_publish_resolves_relative_t019_assets(
    tmp_path: Path, monkeypatch
) -> None:
    topic_image_dir = tmp_path / "topic_images" / "t_019"
    topic_audio_dir = tmp_path / "topic_audio" / "t_019"
    topic_image_dir.mkdir(parents=True)
    topic_audio_dir.mkdir(parents=True)
    (topic_image_dir / "hero.jpg").write_text("image", encoding="utf-8")
    (topic_audio_dir / "clip.mp3").write_text("audio", encoding="utf-8")

    monkeypatch.setattr(publish, "DEFAULT_TOPIC_IMAGE_DIR", topic_image_dir)
    monkeypatch.setattr(publish, "DEFAULT_TOPIC_AUDIO_DIR", topic_audio_dir)

    package = {
        "audio_file": "clip.mp3",
        "selected_visuals": [
            {"type": "article_image", "local_file": "hero.jpg"},
            {
                "type": "generated_card",
                "local_file": str((topic_image_dir / "hero.jpg").resolve()),
            },
            {
                "type": "generated_card",
                "local_file": str((topic_image_dir / "hero.jpg").resolve()),
            },
        ],
    }

    audio_path = publish._package_audio_path(package)
    visuals = publish._package_visuals(package)

    assert audio_path is not None
    assert audio_path == topic_audio_dir / "clip.mp3"
    assert len(visuals) == 3
    assert visuals[0]["src"].startswith("data:image/jpeg;base64,")
    assert publish._as_media_src(audio_path).startswith("data:audio/mpeg;base64,")


def test_render_publish_prefers_explicit_local_paths_over_default_dirs(
    tmp_path: Path, monkeypatch
) -> None:
    actual_image_dir = tmp_path / "actual" / "images"
    actual_audio_dir = tmp_path / "actual" / "audio"
    wrong_image_dir = tmp_path / "wrong" / "images"
    wrong_audio_dir = tmp_path / "wrong" / "audio"
    actual_image_dir.mkdir(parents=True)
    actual_audio_dir.mkdir(parents=True)
    wrong_image_dir.mkdir(parents=True)
    wrong_audio_dir.mkdir(parents=True)

    image_path = actual_image_dir / "hero.jpg"
    audio_path = actual_audio_dir / "clip.mp3"
    image_path.write_text("image", encoding="utf-8")
    audio_path.write_text("audio", encoding="utf-8")

    monkeypatch.setattr(publish, "DEFAULT_TOPIC_IMAGE_DIR", wrong_image_dir)
    monkeypatch.setattr(publish, "DEFAULT_TOPIC_AUDIO_DIR", wrong_audio_dir)

    package = {
        "audio_file": "clip.mp3",
        "audio_local_path": str(audio_path.resolve()),
        "selected_visuals": [
            {
                "type": "article_image",
                "local_file": "hero.jpg",
                "local_path": str(image_path.resolve()),
            },
            {
                "type": "generated_card",
                "local_path": str(image_path.resolve()),
            },
            {
                "type": "generated_card",
                "local_path": str(image_path.resolve()),
            },
        ],
    }

    assert publish._package_audio_path(package) == audio_path
    assert [item["path"] for item in publish._resolved_visual_paths(package)] == [
        image_path,
        image_path,
        image_path,
    ]


def test_render_publish_uses_windows_npm_launcher(monkeypatch) -> None:
    monkeypatch.setattr(publish.os, "name", "nt")
    assert publish._npm_executable() == "npm.cmd"


def test_stage_render_media_copies_assets_into_renderer_public(tmp_path: Path) -> None:
    renderer_dir = tmp_path / "renderer"
    audio_path = tmp_path / "clip.mp3"
    visual_path = tmp_path / "hero.jpg"
    audio_path.write_text("audio", encoding="utf-8")
    visual_path.write_text("image", encoding="utf-8")

    audio_src, visuals, stage_root = publish._stage_render_media(
        renderer_dir=renderer_dir,
        segment_id="cf_topic_demo",
        audio_path=audio_path,
        visuals=[
            {"type": "article_image", "path": visual_path},
            {"type": "generated_card", "path": visual_path},
            {"type": "generated_card", "path": visual_path},
        ],
    )

    assert audio_src == "/t022-render-assets/cf_topic_demo/audio.mp3"
    assert len(visuals) == 3
    assert visuals[0]["src"] == "/t022-render-assets/cf_topic_demo/visual-01.jpg"
    assert (stage_root / "audio.mp3").is_file()
    assert (stage_root / "visual-01.jpg").is_file()
