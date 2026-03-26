from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Callable


def canonical_recording_video_path(topic_dir: Path) -> Path:
    return topic_dir / "recording" / "video.mp4"


def _recording_dir(topic_dir: Path) -> Path:
    return topic_dir / "recording"


def _verbose_path(topic_dir: Path) -> Path:
    return _recording_dir(topic_dir) / "video.stt.verbose.json"


def _text_path(topic_dir: Path) -> Path:
    return _recording_dir(topic_dir) / "video.stt.txt"


def _cleaned_path(topic_dir: Path) -> Path:
    return _recording_dir(topic_dir) / "video.stt.cleaned.md"


def format_segment_line(segment: dict[str, Any]) -> str:
    start = float(segment["start"])
    end = float(segment["end"])
    text = str(segment["text"]).strip()
    return f"[{start:06.2f}-{end:06.2f}] {text}"


def build_cleaned_transcript_scaffold(segments: list[dict[str, Any]]) -> str:
    cleaned = [str(segment.get("text", "")).strip() for segment in segments]
    paragraphs = [text for text in cleaned if text]
    if not paragraphs:
        return ""
    return "\n\n".join(paragraphs) + "\n"


def write_transcript_artifacts(
    topic_dir: Path,
    transcript_payload: dict[str, Any],
    *,
    write_cleaned_scaffold: bool = False,
) -> dict[str, Any]:
    recording_dir = _recording_dir(topic_dir)
    recording_dir.mkdir(parents=True, exist_ok=True)

    segments = transcript_payload.get("segments")
    if not isinstance(segments, list):
        raise ValueError("transcript_payload must include a list of segments")

    verbose_path = _verbose_path(topic_dir)
    text_path = _text_path(topic_dir)
    cleaned_path = _cleaned_path(topic_dir)

    verbose_path.write_text(
        json.dumps(transcript_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    text_path.write_text(
        "\n".join(format_segment_line(segment) for segment in segments) + "\n",
        encoding="utf-8",
    )

    if write_cleaned_scaffold and not cleaned_path.exists():
        cleaned_path.write_text(
            build_cleaned_transcript_scaffold(segments), encoding="utf-8"
        )

    return {
        "recording_dir": str(recording_dir),
        "verbose_json": str(verbose_path),
        "text_path": str(text_path),
        "cleaned_path": str(cleaned_path),
        "segment_count": len(segments),
    }


def _segment_to_dict(segment: object) -> dict[str, Any]:
    return {
        "id": getattr(segment, "id", None),
        "seek": getattr(segment, "seek", None),
        "start": round(float(getattr(segment, "start", 0.0)), 3),
        "end": round(float(getattr(segment, "end", 0.0)), 3),
        "text": str(getattr(segment, "text", "")).strip(),
        "avg_logprob": getattr(segment, "avg_logprob", None),
        "compression_ratio": getattr(segment, "compression_ratio", None),
        "no_speech_prob": getattr(segment, "no_speech_prob", None),
        "temperature": getattr(segment, "temperature", None),
    }


def transcribe_with_faster_whisper(
    video_path: Path,
    *,
    model_name: str = "small",
    language: str = "zh",
) -> dict[str, Any]:
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError(
            "faster-whisper is not installed. Run with `uv run --with faster-whisper` "
            "or install the dependency before using scripts.tldr.transcribe_aroll."
        ) from exc

    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        str(video_path),
        language=language,
        beam_size=5,
        vad_filter=True,
        condition_on_previous_text=True,
    )
    segment_dicts = [_segment_to_dict(segment) for segment in segments]
    return {
        "source": str(video_path),
        "model": model_name,
        "language": getattr(info, "language", None),
        "language_probability": getattr(info, "language_probability", None),
        "duration": getattr(info, "duration", None),
        "duration_after_vad": getattr(info, "duration_after_vad", None),
        "segments": segment_dicts,
    }


def transcribe_topic_aroll(
    topic_dir: Path,
    *,
    transcribe_fn: Callable[[Path], dict[str, Any]] = transcribe_with_faster_whisper,
    write_cleaned_scaffold: bool = False,
) -> dict[str, Any]:
    video_path = canonical_recording_video_path(topic_dir)
    if not video_path.exists():
        raise FileNotFoundError(f"Missing canonical A-roll source: {video_path}")

    transcript_payload = transcribe_fn(video_path)
    result = write_transcript_artifacts(
        topic_dir,
        transcript_payload,
        write_cleaned_scaffold=write_cleaned_scaffold,
    )
    result["video_path"] = str(video_path)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Transcribe a topic's recorded A-roll into standard TLDR artifacts"
    )
    parser.add_argument("--topic-dir", required=True)
    parser.add_argument("--write-cleaned-scaffold", action="store_true")
    args = parser.parse_args()

    topic_dir = Path(args.topic_dir)
    result = transcribe_topic_aroll(
        topic_dir, write_cleaned_scaffold=args.write_cleaned_scaffold
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
