import json
import subprocess
import sys
from pathlib import Path

from scripts.topic_stream.retained_feed_merge import merge_retained_feed


def test_merge_keeps_existing_topics_when_incoming_batch_is_smaller() -> None:
    existing = {
        "room_id": "t_019",
        "program_slug": "china-bigtech",
        "topics": [
            {
                "id": "old_1",
                "published_at": "2026-03-20T04:00:00Z",
                "image_file": "a.jpg",
                "audio_file": "a.mp3",
            },
            {
                "id": "old_2",
                "published_at": "2026-03-20T03:00:00Z",
                "image_file": "b.jpg",
                "audio_file": "b.mp3",
            },
        ],
    }
    incoming = {
        "room_id": "t_019",
        "program_slug": "china-bigtech",
        "topics": [
            {
                "id": "new_1",
                "published_at": "2026-03-20T05:00:00Z",
                "image_file": "c.jpg",
                "audio_file": "c.mp3",
            }
        ],
    }

    merged = merge_retained_feed(existing, incoming, retain_limit=20)

    assert [row["id"] for row in merged["topics"]] == ["new_1", "old_1", "old_2"]
    assert merged["topic_count"] == 3


def test_merge_replaces_same_topic_id_with_newer_payload() -> None:
    existing = {
        "room_id": "t_019",
        "program_slug": "china-bigtech",
        "topics": [
            {
                "id": "topic_x",
                "published_at": "2026-03-20T04:00:00Z",
                "screen_title": "old",
                "image_file": "x.jpg",
                "audio_file": "x.mp3",
            }
        ],
    }
    incoming = {
        "room_id": "t_019",
        "program_slug": "china-bigtech",
        "topics": [
            {
                "id": "topic_x",
                "published_at": "2026-03-20T05:00:00Z",
                "screen_title": "new",
                "image_file": "x2.jpg",
                "audio_file": "x2.mp3",
            }
        ],
    }

    merged = merge_retained_feed(existing, incoming, retain_limit=20)

    assert [row["id"] for row in merged["topics"]] == ["topic_x"]
    assert merged["topic_count"] == 1
    assert merged["topics"][0]["screen_title"] == "new"
    assert merged["topics"][0]["audio_file"] == "x2.mp3"


def test_merge_caps_room_to_latest_twenty_topics() -> None:
    existing_topics = [
        {
            "id": f"topic_{i:02d}",
            "published_at": f"2026-03-20T00:{i:02d}:00Z",
            "image_file": f"{i}.jpg",
            "audio_file": f"{i}.mp3",
        }
        for i in range(25)
    ]

    merged = merge_retained_feed(
        {
            "room_id": "t_019",
            "program_slug": "china-bigtech",
            "topics": existing_topics,
        },
        {"room_id": "t_019", "program_slug": "china-bigtech", "topics": []},
        retain_limit=20,
    )

    assert merged["topic_count"] == 20
    assert [row["id"] for row in merged["topics"]] == [
        f"topic_{i:02d}" for i in range(24, 4, -1)
    ]


def test_merge_sorts_rfc2822_published_at_before_truncation() -> None:
    existing_topics = [
        {
            "id": f"old_{i:02d}",
            "published_at": f"Fri, 20 Mar 2026 0{i}:00:00 GMT",
            "image_file": f"old_{i}.jpg",
            "audio_file": f"old_{i}.mp3",
        }
        for i in range(10)
    ]
    incoming_topics = [
        {
            "id": f"new_{i:02d}",
            "published_at": f"Fri, 20 Mar 2026 1{i}:00:00 GMT",
            "image_file": f"new_{i}.jpg",
            "audio_file": f"new_{i}.mp3",
        }
        for i in range(10)
    ]

    merged = merge_retained_feed(
        {
            "room_id": "t_019",
            "program_slug": "china-bigtech",
            "topics": existing_topics,
        },
        {
            "room_id": "t_019",
            "program_slug": "china-bigtech",
            "topics": incoming_topics,
        },
        retain_limit=10,
    )

    assert merged["topic_count"] == 10
    assert [row["id"] for row in merged["topics"]] == [
        f"new_{i:02d}" for i in range(9, -1, -1)
    ]


def test_merge_drops_rows_with_missing_asset_files_when_asset_dirs_are_supplied(
    tmp_path: Path,
) -> None:
    image_dir = tmp_path / "images"
    audio_dir = tmp_path / "audio"
    image_dir.mkdir()
    audio_dir.mkdir()
    (image_dir / "keep.jpg").write_text("image", encoding="utf-8")
    (audio_dir / "keep.mp3").write_text("audio", encoding="utf-8")
    (image_dir / "audio_missing.jpg").write_text("image", encoding="utf-8")
    (audio_dir / "image_missing.mp3").write_text("audio", encoding="utf-8")

    merged = merge_retained_feed(
        {"room_id": "t_019", "program_slug": "china-bigtech", "topics": []},
        {
            "room_id": "t_019",
            "program_slug": "china-bigtech",
            "topics": [
                {
                    "id": "keep",
                    "published_at": "2026-03-20T05:00:00Z",
                    "image_file": "keep.jpg",
                    "audio_file": "keep.mp3",
                },
                {
                    "id": "missing_audio",
                    "published_at": "2026-03-20T04:00:00Z",
                    "image_file": "audio_missing.jpg",
                    "audio_file": "audio_missing.mp3",
                },
                {
                    "id": "missing_image",
                    "published_at": "2026-03-20T03:00:00Z",
                    "image_file": "image_missing.jpg",
                    "audio_file": "image_missing.mp3",
                },
            ],
        },
        retain_limit=20,
        image_dir=image_dir,
        audio_dir=audio_dir,
    )

    assert [row["id"] for row in merged["topics"]] == ["keep"]
    assert merged["topic_count"] == 1


def test_retained_feed_merge_cli_writes_retained_topics(tmp_path: Path) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    script_path = repo_root / "scripts" / "topic_stream" / "retained_feed_merge.py"
    existing_path = tmp_path / "existing.json"
    incoming_path = tmp_path / "incoming.json"
    output_path = tmp_path / "merged.json"

    existing_path.write_text(
        json.dumps(
            {
                "room_id": "t_019",
                "program_slug": "china-bigtech",
                "topics": [
                    {
                        "id": "old_1",
                        "published_at": "2026-03-20T04:00:00Z",
                        "image_file": "a.jpg",
                        "audio_file": "a.mp3",
                    },
                    {
                        "id": "old_2",
                        "published_at": "2026-03-20T03:00:00Z",
                        "image_file": "b.jpg",
                        "audio_file": "b.mp3",
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    incoming_path.write_text(
        json.dumps(
            {
                "room_id": "t_019",
                "program_slug": "china-bigtech",
                "as_of": "2026-03-20T06:00:00Z",
                "topics": [
                    {
                        "id": "new_1",
                        "published_at": "2026-03-20T05:00:00Z",
                        "image_file": "c.jpg",
                        "audio_file": "c.mp3",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            sys.executable,
            str(script_path),
            "--existing",
            str(existing_path),
            "--incoming",
            str(incoming_path),
            "--output",
            str(output_path),
            "--retain-limit",
            "2",
            "--room-id",
            "t_019",
            "--program-slug",
            "china-bigtech",
        ],
        cwd=repo_root,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        universal_newlines=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert [row["id"] for row in payload["topics"]] == ["new_1", "old_1"]
    assert payload["topic_count"] == 2
    assert payload["as_of"] == "2026-03-20T06:00:00Z"


def test_retained_feed_merge_cli_filters_missing_asset_files_when_dirs_are_passed(
    tmp_path: Path,
) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    script_path = repo_root / "scripts" / "topic_stream" / "retained_feed_merge.py"
    existing_path = tmp_path / "existing.json"
    incoming_path = tmp_path / "incoming.json"
    output_path = tmp_path / "merged.json"
    image_dir = tmp_path / "images"
    audio_dir = tmp_path / "audio"
    image_dir.mkdir()
    audio_dir.mkdir()
    (image_dir / "keep.jpg").write_text("image", encoding="utf-8")
    (audio_dir / "keep.mp3").write_text("audio", encoding="utf-8")
    (image_dir / "missing_audio.jpg").write_text("image", encoding="utf-8")

    existing_path.write_text(
        json.dumps({"room_id": "t_019", "program_slug": "china-bigtech", "topics": []}),
        encoding="utf-8",
    )
    incoming_path.write_text(
        json.dumps(
            {
                "room_id": "t_019",
                "program_slug": "china-bigtech",
                "topics": [
                    {
                        "id": "keep",
                        "published_at": "2026-03-20T05:00:00Z",
                        "image_file": "keep.jpg",
                        "audio_file": "keep.mp3",
                    },
                    {
                        "id": "drop_missing_audio",
                        "published_at": "2026-03-20T04:00:00Z",
                        "image_file": "missing_audio.jpg",
                        "audio_file": "missing_audio.mp3",
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            sys.executable,
            str(script_path),
            "--existing",
            str(existing_path),
            "--incoming",
            str(incoming_path),
            "--output",
            str(output_path),
            "--retain-limit",
            "20",
            "--room-id",
            "t_019",
            "--program-slug",
            "china-bigtech",
            "--image-dir",
            str(image_dir),
            "--audio-dir",
            str(audio_dir),
        ],
        cwd=repo_root,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        universal_newlines=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert [row["id"] for row in payload["topics"]] == ["keep"]
    assert payload["topic_count"] == 1


def test_retained_feed_merge_source_avoids_python_36_only_incompatible_constructs() -> (
    None
):
    source = (
        Path(__file__).with_name("retained_feed_merge.py").read_text(encoding="utf-8")
    )

    assert "from __future__ import annotations" not in source
    assert "datetime.fromisoformat" not in source
    assert " | " not in source
