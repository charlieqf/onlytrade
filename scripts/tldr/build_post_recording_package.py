from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

from scripts.tldr.transcribe_aroll import (
    canonical_recording_media_path,
    transcribe_topic_aroll,
    transcribe_with_faster_whisper,
)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _normalize_version(version: str) -> str:
    version = str(version or "v1").strip()
    return version if version.startswith("v") else f"v{version}"


def _load_topic_json(topic_dir: Path) -> dict[str, Any]:
    topic_path = topic_dir / "topic.json"
    if not topic_path.exists():
        raise FileNotFoundError(f"Missing topic.json: {topic_path}")
    return json.loads(topic_path.read_text(encoding="utf-8"))


def _safe_text(value: Any, max_len: int = 2000) -> str:
    text = str(value or "").replace("\r", " ").replace("\n", " ").replace("\t", " ")
    text = " ".join(text.split()).strip()
    if not text:
        return ""
    return text[:max_len]


def _public_slug(topic_key: str) -> str:
    return topic_key.replace("_", "-")


def _extract_source_label(topic_data: dict[str, Any]) -> str:
    links = topic_data.get("source_links")
    if isinstance(links, list):
        for item in links:
            if isinstance(item, dict):
                label = _safe_text(item.get("label"), 80)
                if label:
                    return label
                url = _safe_text(item.get("url"), 1000)
                if url:
                    return urlparse(url).netloc or "Source"
    url = _safe_text(topic_data.get("source_url"), 1000)
    if url:
        return urlparse(url).netloc or "Source"
    sources = topic_data.get("sources")
    if isinstance(sources, list) and sources:
        return urlparse(_safe_text(sources[0], 1000)).netloc or "Source"
    return "Source"


def _extract_headline(topic_data: dict[str, Any]) -> str:
    for key in ("screen_title_cn", "title", "title_en", "topic_key"):
        value = _safe_text(topic_data.get(key), 120)
        if value:
            return value
    return "TLDR AI Daily"


def _load_asset_manifest(topic_dir: Path, version: str) -> dict[str, Any]:
    path = topic_dir / f"sample_cut_{version}_asset_manifest.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _load_source_asset_manifest(topic_dir: Path) -> dict[str, Any]:
    path = topic_dir / "assets" / "source_asset_manifest.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _verbose_transcript_path(topic_dir: Path) -> Path:
    return topic_dir / "recording" / "video.stt.verbose.json"


def _resolve_topic_asset_path(root_dir: Path, topic_dir: Path, raw: str) -> Path | None:
    if not raw:
        return None
    candidate = Path(raw)
    if candidate.is_absolute():
        return candidate if candidate.exists() else None
    topic_relative = topic_dir / candidate
    if topic_relative.exists():
        return topic_relative
    root_relative = root_dir / candidate
    if root_relative.exists():
        return root_relative
    return None


def build_subtitle_cues_from_segments(
    segments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    cues: list[dict[str, Any]] = []
    for segment in segments:
        text = _safe_text(segment.get("text"), 120)
        if not text:
            continue
        start = round(float(segment.get("start", 0.0)), 2)
        end = round(float(segment.get("end", start)), 2)
        if end <= start:
            end = round(start + 1.0, 2)
        cues.append({"startSec": start, "endSec": end, "text": text})
    return cues


def _load_cleaned_subtitle_lines(topic_dir: Path) -> list[str]:
    cleaned_path = topic_dir / "recording" / "video.stt.cleaned.md"
    if not cleaned_path.exists():
        return []
    lines = cleaned_path.read_text(encoding="utf-8").splitlines()
    return [_safe_text(line, 240) for line in lines if _safe_text(line, 240)]


def _apply_cleaned_text_to_cues(topic_dir: Path, cues: list[dict[str, Any]]) -> None:
    cleaned_lines = _load_cleaned_subtitle_lines(topic_dir)
    if len(cleaned_lines) != len(cues):
        return
    for cue, cleaned_text in zip(cues, cleaned_lines, strict=True):
        cue["text"] = cleaned_text


def _stage_public_assets(
    topic_dir: Path, root_dir: Path, *, version: str, public_slug: str
) -> dict[str, Any]:
    public_dir = (
        root_dir
        / f"content-factory-renderer/public/tldr-sample/{public_slug}-{version}"
    )
    public_dir.mkdir(parents=True, exist_ok=True)
    recording_src = canonical_recording_media_path(topic_dir)
    media_props: dict[str, Any] = {"public_dir": public_dir}
    if recording_src.suffix.lower() == ".mp4":
        shutil.copyfile(recording_src, public_dir / "aroll-video.mp4")
        media_props["videoSrc"] = f"tldr-sample/{public_slug}-{version}/aroll-video.mp4"
    else:
        audio_name = f"audio-bed{recording_src.suffix.lower()}"
        shutil.copyfile(recording_src, public_dir / audio_name)
        media_props["audioSrc"] = f"tldr-sample/{public_slug}-{version}/{audio_name}"
    archive_dir = topic_dir / f"sample_cut_{version}_assets"
    if archive_dir.exists():
        for asset_path in archive_dir.iterdir():
            if asset_path.is_file():
                shutil.copyfile(asset_path, public_dir / asset_path.name)
    return media_props


def _select_cutaway_candidates(
    *,
    root_dir: Path,
    topic_dir: Path,
    version: str,
) -> list[dict[str, Any]]:
    manifest = _load_asset_manifest(topic_dir, version)
    items = manifest.get("recommended_primary_assets")
    if not isinstance(items, list):
        items = []
    selected: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        raw_path = _safe_text(item.get("path"), 1000)
        resolved = _resolve_topic_asset_path(root_dir, topic_dir, raw_path)
        if not resolved or not resolved.exists() or resolved.suffix.lower() == ".mp4":
            continue
        selected.append(
            {
                "asset_name": resolved.name,
                "label": _safe_text(item.get("role"), 24) or "资料",
                "spoken_section": _safe_text(item.get("spoken_section"), 120),
            }
        )
    if selected:
        return selected[:4]

    fallback_manifest = _load_source_asset_manifest(topic_dir)
    archived_assets = (
        fallback_manifest.get("archived_assets")
        if isinstance(fallback_manifest.get("archived_assets"), list)
        else []
    )
    for raw_path in archived_assets:
        resolved = _resolve_topic_asset_path(
            root_dir, topic_dir, _safe_text(raw_path, 1000)
        )
        if not resolved or not resolved.exists():
            continue
        selected.append(
            {
                "asset_name": resolved.name,
                "label": "来源",
                "spoken_section": "source asset",
            }
        )
    return selected[:4]


def build_cutaways(
    *,
    duration_in_seconds: float,
    candidates: list[dict[str, Any]],
    public_slug: str,
    version: str,
    full_span: bool = False,
) -> list[dict[str, Any]]:
    if not candidates:
        return []
    opening_guard = 0.8 if full_span else 4.0
    closing_guard = 0.8 if full_span else 4.0
    usable = duration_in_seconds - opening_guard - closing_guard
    if usable <= 3.0:
        return []
    cutaways: list[dict[str, Any]] = []
    if full_span:
        slot = usable / max(1, len(candidates))
        for index, candidate in enumerate(candidates):
            start = round(opening_guard + slot * index, 2)
            end = round(min(duration_in_seconds - closing_guard, start + slot), 2)
            if end <= start:
                continue
            cutaways.append(
                {
                    "startSec": start,
                    "endSec": end,
                    "assetSrc": f"tldr-sample/{public_slug}-{version}/{candidate['asset_name']}",
                    "label": candidate["label"],
                    "fitMode": "contain",
                    "motion": "none",
                }
            )
        return cutaways

    window = min(5.0, max(3.0, usable / max(1, len(candidates) + 1)))
    for index, candidate in enumerate(candidates, start=1):
        center = opening_guard + usable * index / (len(candidates) + 1)
        start = round(max(opening_guard, center - window / 2), 2)
        end = round(min(duration_in_seconds - closing_guard, start + window), 2)
        if end <= start:
            continue
        cutaways.append(
            {
                "startSec": start,
                "endSec": end,
                "assetSrc": f"tldr-sample/{public_slug}-{version}/{candidate['asset_name']}",
                "label": candidate["label"],
                "fitMode": "contain",
                "motion": "none",
            }
        )
    return cutaways


def _build_cut_plan_markdown(
    cues: list[dict[str, Any]], cutaways: list[dict[str, Any]]
) -> str:
    lines = [
        "# Auto Cut Plan",
        "",
        "This file was generated from the real A-roll transcript. Review and refine before final publish if needed.",
        "",
        "## Subtitle Cues",
        "",
    ]
    for cue in cues:
        lines.append(f"- `{cue['startSec']:.2f}s - {cue['endSec']:.2f}s` {cue['text']}")
    lines.extend(["", "## Auto Cutaways", ""])
    if not cutaways:
        lines.append(
            "- No cutaways selected automatically. A-roll with subtitles only."
        )
    else:
        for cutaway in cutaways:
            lines.append(
                f"- `{cutaway['startSec']:.2f}s - {cutaway['endSec']:.2f}s` {cutaway['label']} -> {cutaway['assetSrc']}"
            )
    lines.append("")
    return "\n".join(lines)


def _ensure_transcript_payload(
    topic_dir: Path,
    *,
    transcribe_callable: Callable[[Path], dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, Any]]:
    verbose_path = _verbose_transcript_path(topic_dir)
    if verbose_path.exists():
        payload = json.loads(verbose_path.read_text(encoding="utf-8"))
        segments = payload.get("segments")
        if isinstance(segments, list):
            return payload, {
                "recording_dir": str(topic_dir / "recording"),
                "verbose_json": str(verbose_path),
                "text_path": str(topic_dir / "recording" / "video.stt.txt"),
                "cleaned_path": str(topic_dir / "recording" / "video.stt.cleaned.md"),
                "segment_count": len(segments),
                "source_path": str(canonical_recording_media_path(topic_dir)),
                "video_path": str(canonical_recording_media_path(topic_dir)),
                "reused_verbose_transcript": True,
            }

    transcript_result = transcribe_topic_aroll(
        topic_dir,
        transcribe_fn=transcribe_callable,
        write_cleaned_scaffold=True,
    )
    payload = json.loads(verbose_path.read_text(encoding="utf-8"))
    return payload, transcript_result


def build_post_recording_package(
    topic_dir: Path,
    *,
    root_dir: Path | None = None,
    version: str = "v1",
    transcribe_fn: Callable[[Path], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    topic_dir = Path(topic_dir)
    root_dir = Path(root_dir) if root_dir is not None else _repo_root()
    version = _normalize_version(version)
    topic_data = _load_topic_json(topic_dir)

    transcribe_callable = transcribe_fn or transcribe_with_faster_whisper
    verbose_payload, transcript_result = _ensure_transcript_payload(
        topic_dir,
        transcribe_callable=transcribe_callable,
    )
    segments = (
        verbose_payload.get("segments")
        if isinstance(verbose_payload.get("segments"), list)
        else []
    )
    cues = build_subtitle_cues_from_segments(segments)
    _apply_cleaned_text_to_cues(topic_dir, cues)
    duration_in_seconds = round(
        max([float(segment.get("end", 0.0)) for segment in segments] or [0.0]), 2
    )

    public_slug = _public_slug(
        _safe_text(topic_data.get("topic_key"), 120) or "tldr-topic"
    )
    media_props = _stage_public_assets(
        topic_dir, root_dir, version=version, public_slug=public_slug
    )
    cutaway_candidates = _select_cutaway_candidates(
        root_dir=root_dir,
        topic_dir=topic_dir,
        version=version,
    )
    cutaways = build_cutaways(
        duration_in_seconds=duration_in_seconds,
        candidates=cutaway_candidates,
        public_slug=public_slug,
        version=version,
        full_span="videoSrc" not in media_props,
    )

    recording_dir = topic_dir / "recording"
    sample_dir = topic_dir / f"sample_cut_{version}"
    sample_dir.mkdir(parents=True, exist_ok=True)
    subtitle_path = recording_dir / "video.subtitle.cues.json"
    cut_plan_path = recording_dir / "video.cut-plan.md"
    render_props_path = sample_dir / f"sample_cut_{version}_render_props.json"

    subtitle_path.write_text(
        json.dumps(cues, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    cut_plan_path.write_text(_build_cut_plan_markdown(cues, cutaways), encoding="utf-8")

    render_props = {
        "durationInSeconds": duration_in_seconds,
        "headline": _extract_headline(topic_data),
        "sourceLabel": _extract_source_label(topic_data),
        "subtitleCues": cues,
        "cutaways": cutaways,
    }
    render_props.update(
        {
            key: value
            for key, value in media_props.items()
            if key in {"videoSrc", "audioSrc"}
        }
    )
    render_props_path.write_text(
        json.dumps(render_props, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return {
        "topic_dir": str(topic_dir),
        "duration_in_seconds": duration_in_seconds,
        "subtitle_cue_count": len(cues),
        "cutaway_count": len(cutaways),
        "render_props_path": str(render_props_path),
        "transcript_result": transcript_result,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build post-recording subtitle and render package for a TLDR topic"
    )
    parser.add_argument("--topic-dir", required=True)
    parser.add_argument("--version", default="v1")
    args = parser.parse_args()
    result = build_post_recording_package(Path(args.topic_dir), version=args.version)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
