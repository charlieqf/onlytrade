from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


_CJK = r"\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff"
_CJK_SPACE = re.compile(rf"([{_CJK}])\s+([{_CJK}])")
_SPACE_BEFORE_PUNCT = re.compile(r"\s+([,.;:!?，。；：！？])")
_MULTI_SPACE = re.compile(r"\s+")


def _verbose_path(topic_dir: Path) -> Path:
    return topic_dir / "recording" / "video.stt.verbose.json"


def _cleaned_path(topic_dir: Path) -> Path:
    return topic_dir / "recording" / "video.stt.cleaned.md"


def normalize_segment_text(text: str) -> str:
    cleaned = str(text or "").replace("\r", " ").replace("\n", " ").strip()
    cleaned = _MULTI_SPACE.sub(" ", cleaned)
    while True:
        updated = _CJK_SPACE.sub(r"\1\2", cleaned)
        if updated == cleaned:
            break
        cleaned = updated
    cleaned = _SPACE_BEFORE_PUNCT.sub(r"\1", cleaned)
    return cleaned.strip()


def _load_segments(topic_dir: Path) -> list[dict[str, Any]]:
    verbose_path = _verbose_path(topic_dir)
    if not verbose_path.exists():
        raise FileNotFoundError(f"Missing verbose transcript payload: {verbose_path}")
    payload = json.loads(verbose_path.read_text(encoding="utf-8"))
    segments = payload.get("segments")
    if not isinstance(segments, list):
        raise ValueError("transcript payload must contain a list of segments")
    return [segment for segment in segments if isinstance(segment, dict)]


def derive_headline_from_lines(lines: list[str], *, max_len: int = 28) -> str:
    for line in lines:
        cleaned = normalize_segment_text(line)
        if cleaned:
            return cleaned[:max_len]
    return "Audio Card Briefing"


def auto_clean_transcript(topic_dir: Path) -> dict[str, Any]:
    topic_dir = Path(topic_dir)
    cleaned_path = _cleaned_path(topic_dir)
    segments = _load_segments(topic_dir)
    lines = [
        normalize_segment_text(str(segment.get("text", ""))) for segment in segments
    ]
    cleaned_lines = [line for line in lines if line]
    cleaned_path.write_text(
        "\n\n".join(cleaned_lines) + ("\n" if cleaned_lines else ""), encoding="utf-8"
    )
    return {
        "cleaned_path": str(cleaned_path),
        "line_count": len(cleaned_lines),
        "headline": derive_headline_from_lines(cleaned_lines),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Deterministically clean a TLDR transcript scaffold into card-friendly lines"
    )
    parser.add_argument("--topic-dir", required=True)
    args = parser.parse_args()
    result = auto_clean_transcript(Path(args.topic_dir))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
