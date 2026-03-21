import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def atomic_write_json(file_path, payload):
    target = Path(file_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(target.suffix + ".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temp.replace(target)


def _require_matching_identity(existing_payload, incoming_payload):
    room_values = {
        str(value).strip()
        for value in (existing_payload.get("room_id"), incoming_payload.get("room_id"))
        if str(value or "").strip()
    }
    program_values = {
        str(value).strip()
        for value in (
            existing_payload.get("program_slug"),
            incoming_payload.get("program_slug"),
        )
        if str(value or "").strip()
    }
    if len(room_values) != 1 or len(program_values) != 1:
        raise ValueError("room_id and program_slug must match")
    return next(iter(room_values)), next(iter(program_values))


def _segment_topic_id(row):
    return str(row.get("topic_id") or row.get("id") or "").strip()


def _is_valid_segment(row):
    if not isinstance(row, dict):
        return False
    if not _segment_topic_id(row):
        return False
    return bool(str(row.get("video_file") or "").strip())


def _row_assets_exist(row, video_dir=None, poster_dir=None):
    if video_dir is not None:
        video_file = str(row.get("video_file") or "").strip()
        if not video_file or not (video_dir / video_file).is_file():
            return False
    if poster_dir is not None:
        poster_file = str(row.get("poster_file") or "").strip()
        if not poster_file or not (poster_dir / poster_file).is_file():
            return False
    return True


def _parse_published_at(value):
    text = str(value or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    normalized = text
    if len(normalized) >= 6 and normalized[-6] in ("+", "-") and normalized[-3] == ":":
        normalized = normalized[:-3] + normalized[-2:]
    parsed = None
    for fmt in (
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S",
    ):
        try:
            parsed = datetime.strptime(normalized, fmt)
            break
        except ValueError:
            continue
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _as_utc_iso_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _choose_newer_segment(current_row, candidate_row):
    if current_row is None:
        return candidate_row

    current_published_at = _parse_published_at(current_row.get("published_at"))
    candidate_published_at = _parse_published_at(candidate_row.get("published_at"))

    if current_published_at is not None and candidate_published_at is not None:
        if candidate_published_at > current_published_at:
            return candidate_row
        return current_row

    if current_published_at is None and candidate_published_at is not None:
        return candidate_row

    if current_published_at is not None and candidate_published_at is None:
        return current_row

    return current_row


def _segment_sort_key(row, topic_positions):
    published_at = _parse_published_at(row.get("published_at"))
    if published_at is None:
        published_ts = 0.0
    else:
        published_ts = -published_at.timestamp()
    return (published_at is None, published_ts, topic_positions[_segment_topic_id(row)])


def merge_retained_segments(
    existing_payload,
    incoming_payload,
    retain_limit=20,
    video_dir=None,
    poster_dir=None,
):
    existing = existing_payload if isinstance(existing_payload, dict) else {}
    incoming = incoming_payload if isinstance(incoming_payload, dict) else {}
    room_id, program_slug = _require_matching_identity(existing, incoming)

    merged_segments = {}
    topic_positions = {}
    topic_order = 0

    for payload in (existing, incoming):
        for row in payload.get("segments") or []:
            if not _is_valid_segment(row):
                continue
            if not _row_assets_exist(row, video_dir=video_dir, poster_dir=poster_dir):
                continue
            topic_id = _segment_topic_id(row)
            if topic_id not in topic_positions:
                topic_positions[topic_id] = topic_order
                topic_order += 1
            normalized = dict(row)
            normalized.setdefault("topic_id", topic_id)
            normalized.setdefault("id", topic_id)
            merged_segments[topic_id] = _choose_newer_segment(
                merged_segments.get(topic_id), normalized
            )

    segments = list(merged_segments.values())
    segments.sort(key=lambda row: _segment_sort_key(row, topic_positions))
    limited_segments = segments[: max(0, int(retain_limit))]

    merged_payload = dict(existing)
    merged_payload.update(incoming)
    merged_payload["room_id"] = room_id
    merged_payload["program_slug"] = program_slug
    merged_payload["segments"] = limited_segments
    merged_payload["segment_count"] = len(limited_segments)
    merged_payload["as_of"] = incoming.get("as_of") or _as_utc_iso_now()
    return merged_payload


def _load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def _apply_identity_arg(payload, key, expected):
    if not expected:
        return
    actual = str(payload.get(key) or "").strip()
    if actual and actual != expected:
        raise ValueError(
            "{0} mismatch: expected {1}, got {2}".format(key, expected, actual)
        )
    payload.setdefault(key, expected)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Merge retained content-factory manifests"
    )
    parser.add_argument("--existing", required=True)
    parser.add_argument("--incoming", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--retain-limit", type=int, default=20)
    parser.add_argument("--room-id")
    parser.add_argument("--program-slug")
    parser.add_argument("--video-dir")
    parser.add_argument("--poster-dir")
    args = parser.parse_args(argv)

    existing_path = Path(args.existing)
    incoming_path = Path(args.incoming)
    existing_payload = _load_json(existing_path) if existing_path.exists() else {}
    incoming_payload = _load_json(incoming_path)

    if not isinstance(existing_payload, dict):
        existing_payload = {}
    if not isinstance(incoming_payload, dict):
        raise ValueError("incoming payload must be a JSON object")

    _apply_identity_arg(existing_payload, "room_id", args.room_id)
    _apply_identity_arg(existing_payload, "program_slug", args.program_slug)
    _apply_identity_arg(incoming_payload, "room_id", args.room_id)
    _apply_identity_arg(incoming_payload, "program_slug", args.program_slug)

    merged = merge_retained_segments(
        existing_payload,
        incoming_payload,
        retain_limit=args.retain_limit,
        video_dir=Path(args.video_dir) if args.video_dir else None,
        poster_dir=Path(args.poster_dir) if args.poster_dir else None,
    )
    atomic_write_json(args.output, merged)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
