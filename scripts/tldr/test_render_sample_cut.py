import json
from pathlib import Path

import pytest

from scripts.tldr.render_sample_cut import (
    create_render_context,
    render_sample_cut,
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
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def test_create_render_context_uses_standard_output_names(tmp_path: Path) -> None:
    root_dir = tmp_path
    topic_dir = root_dir / "data/live/onlytrade/tldr_workspace/2026-03-26/01_test_topic"
    _write_topic_json(topic_dir)

    context = create_render_context(
        topic_dir,
        version="v1",
        root_dir=root_dir,
        preview_seconds=[1, 7.9, 24],
    )

    assert (
        context.render_props_path
        == topic_dir / "sample_cut_v1" / "sample_cut_v1_render_props.json"
    )
    assert (
        context.output_video_path
        == topic_dir / "sample_cut_v1" / "anthropic_harness_design_sample_v1.mp4"
    )
    assert (
        context.metadata_path
        == topic_dir
        / "sample_cut_v1"
        / "anthropic_harness_design_sample_v1.metadata.json"
    )
    assert (
        context.process_note_path
        == topic_dir / "sample_cut_v1" / "sample_cut_v1_process.md"
    )
    assert [p.name for p in context.preview_paths] == [
        "preview_1s.jpg",
        "preview_7_9s.jpg",
        "preview_24s.jpg",
    ]


def test_render_sample_cut_invokes_runner_and_writes_metadata_and_process_note(
    tmp_path: Path,
) -> None:
    root_dir = tmp_path
    topic_dir = root_dir / "data/live/onlytrade/tldr_workspace/2026-03-26/01_test_topic"
    _write_topic_json(topic_dir)
    sample_dir = topic_dir / "sample_cut_v1"
    sample_dir.mkdir(parents=True)
    render_props_path = sample_dir / "sample_cut_v1_render_props.json"
    render_props_path.write_text(
        json.dumps({"durationInSeconds": 28.24}), encoding="utf-8"
    )

    context = create_render_context(
        topic_dir,
        version="v1",
        root_dir=root_dir,
        preview_seconds=[1, 8],
    )

    calls: list[tuple[str, str]] = []

    def fake_runner(command: str, *, workdir: Path) -> None:
        calls.append((command, str(workdir)))
        if " remotion render " in f" {command} ":
            context.output_video_path.write_bytes(b"video")
        elif " remotion still " in f" {command} ":
            output_arg = command.split('"')[1]
            Path(output_arg).write_bytes(b"jpg")

    result = render_sample_cut(context, runner=fake_runner)

    assert len(calls) == 3
    assert calls[0][1].endswith("content-factory-renderer")
    assert context.output_video_path.exists()
    assert all(path.exists() for path in context.preview_paths)

    metadata = json.loads(context.metadata_path.read_text(encoding="utf-8"))
    assert metadata["video"] == "anthropic_harness_design_sample_v1.mp4"
    assert metadata["renderProps"] == "sample_cut_v1_render_props.json"
    assert metadata["previewFrames"] == ["preview_1s.jpg", "preview_8s.jpg"]
    assert metadata["fileSizeBytes"] == 5

    process_note = context.process_note_path.read_text(encoding="utf-8")
    assert "anthropic_harness_design_sample_v1.mp4" in process_note
    assert "preview_1s.jpg" in process_note
    assert result["output_video"] == str(context.output_video_path)


def test_render_sample_cut_requires_render_props_file(tmp_path: Path) -> None:
    topic_dir = tmp_path / "01_test_topic"
    _write_topic_json(topic_dir)
    context = create_render_context(
        topic_dir, version="v1", root_dir=tmp_path, preview_seconds=[1]
    )

    with pytest.raises(FileNotFoundError, match="render props"):
        render_sample_cut(context, runner=lambda *_args, **_kwargs: None)
