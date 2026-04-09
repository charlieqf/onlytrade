import json
from pathlib import Path

from scripts.tldr.clean_transcript import (
    auto_clean_transcript,
    derive_headline_from_lines,
)


def _write_verbose_payload(topic_dir: Path) -> None:
    recording_dir = topic_dir / "recording"
    recording_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "segments": [
            {"id": 0, "start": 0.0, "end": 1.5, "text": "今天  来聊  一下 AI 找漏洞  "},
            {"id": 1, "start": 1.5, "end": 3.0, "text": "它 已经 逼得 行业 提前 联防"},
            {"id": 2, "start": 3.0, "end": 4.5, "text": "最后 看 的 是  窗口期"},
        ]
    }
    (recording_dir / "video.stt.verbose.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def test_auto_clean_transcript_rewrites_cleaned_md_from_verbose_segments(
    tmp_path: Path,
) -> None:
    topic_dir = tmp_path / "01_test_topic"
    _write_verbose_payload(topic_dir)

    result = auto_clean_transcript(topic_dir)

    cleaned_path = topic_dir / "recording" / "video.stt.cleaned.md"
    cleaned_lines = [
        line.strip()
        for line in cleaned_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]

    assert result["line_count"] == 3
    assert cleaned_path.exists()
    assert cleaned_lines[0] == "今天来聊一下 AI 找漏洞"
    assert cleaned_lines[2] == "最后看的是窗口期"


def test_derive_headline_from_lines_uses_first_meaningful_line() -> None:
    headline = derive_headline_from_lines(
        [
            "",
            "今天来聊一下 AI 找漏洞",
            "它已经逼得行业提前联防",
        ]
    )

    assert headline == "今天来聊一下 AI 找漏洞"
