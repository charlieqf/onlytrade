import json
from pathlib import Path

import pytest

from scripts.tldr.transcribe_aroll import (
    transcribe_topic_aroll,
    write_transcript_artifacts,
)


def _sample_transcript_payload() -> dict:
    return {
        "source": "recording/video.mp4",
        "model": "small",
        "language": "zh",
        "language_probability": 0.99,
        "duration": 32.54,
        "duration_after_vad": 31.22,
        "segments": [
            {
                "id": 0,
                "start": 1.14,
                "end": 2.94,
                "text": "今天说一条 Anthropic 的消息。",
            },
            {
                "id": 1,
                "start": 2.94,
                "end": 4.74,
                "text": "Claude Code 现在上了 auto mode。",
            },
        ],
    }


def test_write_transcript_artifacts_creates_standard_recording_files(
    tmp_path: Path,
) -> None:
    topic_dir = tmp_path / "01_test_topic"
    recording_dir = topic_dir / "recording"
    recording_dir.mkdir(parents=True)

    result = write_transcript_artifacts(
        topic_dir,
        _sample_transcript_payload(),
        write_cleaned_scaffold=True,
    )

    verbose_path = recording_dir / "video.stt.verbose.json"
    text_path = recording_dir / "video.stt.txt"
    cleaned_path = recording_dir / "video.stt.cleaned.md"

    assert result["segment_count"] == 2
    assert verbose_path.exists()
    assert text_path.exists()
    assert cleaned_path.exists()

    verbose_payload = json.loads(verbose_path.read_text(encoding="utf-8"))
    assert verbose_payload["language"] == "zh"
    assert verbose_payload["segments"][0]["text"] == "今天说一条 Anthropic 的消息。"

    text_output = text_path.read_text(encoding="utf-8")
    assert "[001.14-002.94] 今天说一条 Anthropic 的消息。" in text_output
    assert "[002.94-004.74] Claude Code 现在上了 auto mode。" in text_output

    cleaned_output = cleaned_path.read_text(encoding="utf-8")
    assert "今天说一条 Anthropic 的消息。" in cleaned_output
    assert "Claude Code 现在上了 auto mode。" in cleaned_output


def test_transcribe_topic_aroll_uses_canonical_recording_video(tmp_path: Path) -> None:
    topic_dir = tmp_path / "01_test_topic"
    recording_dir = topic_dir / "recording"
    recording_dir.mkdir(parents=True)
    video_path = recording_dir / "video.mp4"
    video_path.write_bytes(b"fake-video")

    calls: list[Path] = []

    def fake_transcribe(path: Path) -> dict:
        calls.append(path)
        payload = _sample_transcript_payload()
        payload["source"] = str(path)
        return payload

    result = transcribe_topic_aroll(
        topic_dir,
        transcribe_fn=fake_transcribe,
        write_cleaned_scaffold=False,
    )

    assert calls == [video_path]
    assert result["segment_count"] == 2
    assert result["video_path"] == str(video_path)
    assert (recording_dir / "video.stt.verbose.json").exists()
    assert (recording_dir / "video.stt.txt").exists()
    assert not (recording_dir / "video.stt.cleaned.md").exists()


def test_transcribe_topic_aroll_requires_recording_video(tmp_path: Path) -> None:
    topic_dir = tmp_path / "01_test_topic"
    (topic_dir / "recording").mkdir(parents=True)

    with pytest.raises(FileNotFoundError, match="recording"):
        transcribe_topic_aroll(topic_dir, transcribe_fn=lambda _path: {})
