import argparse
from email.utils import parsedate_to_datetime
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def atomic_write_json(file_path: str, payload: Any) -> None:
    target = Path(file_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(target.suffix + ".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temp.replace(target)


def _require_matching_identity(
    existing_payload: Dict[str, Any], incoming_payload: Dict[str, Any]
) -> Tuple[str, str]:
    room_values = {
        str(value).strip()
        for value in (
            existing_payload.get("room_id"),
            incoming_payload.get("room_id"),
        )
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


def _is_valid_topic(row: Any) -> bool:
    if not isinstance(row, dict):
        return False
    return all(
        str(row.get(key) or "").strip() for key in ("id", "image_file", "audio_file")
    )


def _row_assets_exist(
    row: Dict[str, Any], image_dir: Optional[Path], audio_dir: Optional[Path]
) -> bool:
    checks = (
        (image_dir, "image_file"),
        (audio_dir, "audio_file"),
    )
    for base_dir, field in checks:
        if base_dir is None:
            continue
        asset_name = str(row.get(field) or "").strip()
        if not asset_name:
            return False
        if not (base_dir / asset_name).is_file():
            return False
    return True


def _parse_published_at(value: Any) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed_rfc = parsedate_to_datetime(text)
    except (TypeError, ValueError, IndexError, OverflowError):
        parsed_rfc = None
    if parsed_rfc is not None:
        if parsed_rfc.tzinfo is None:
            parsed_rfc = parsed_rfc.replace(tzinfo=timezone.utc)
        return parsed_rfc.astimezone(timezone.utc)
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


def _as_utc_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _topic_sort_key(
    row: Dict[str, Any], topic_positions: Dict[str, int]
) -> Tuple[bool, float, int]:
    published_at = _parse_published_at(row.get("published_at"))
    if published_at is None:
        published_ts = 0.0
    else:
        published_ts = -published_at.timestamp()
    return (
        published_at is None,
        published_ts,
        topic_positions[str(row["id"])],
    )


def merge_retained_feed(
    existing_payload: Any,
    incoming_payload: Any,
    *,
    retain_limit: int = 20,
    image_dir: Optional[Path] = None,
    audio_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    existing = existing_payload if isinstance(existing_payload, dict) else {}
    incoming = incoming_payload if isinstance(incoming_payload, dict) else {}
    room_id, program_slug = _require_matching_identity(existing, incoming)

    merged_topics: Dict[str, Dict[str, Any]] = {}
    topic_order = 0
    topic_positions: Dict[str, int] = {}
    for payload in (existing, incoming):
        for row in payload.get("topics") or []:
            if not _is_valid_topic(row):
                continue
            if not _row_assets_exist(row, image_dir=image_dir, audio_dir=audio_dir):
                continue
            topic_id = str(row["id"])
            if topic_id not in topic_positions:
                topic_positions[topic_id] = topic_order
                topic_order += 1
            merged_topics[topic_id] = dict(row)

    topics = list(merged_topics.values())
    topics.sort(key=lambda row: _topic_sort_key(row, topic_positions))
    limited_topics = topics[: max(0, int(retain_limit))]

    merged_payload = dict(existing)
    merged_payload.update(incoming)
    merged_payload["room_id"] = room_id
    merged_payload["program_slug"] = program_slug
    merged_payload["topics"] = limited_topics
    merged_payload["topic_count"] = len(limited_topics)
    merged_payload["as_of"] = incoming.get("as_of") or _as_utc_iso_now()
    return merged_payload


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _apply_identity_arg(
    payload: Dict[str, Any], key: str, expected: Optional[str]
) -> None:
    if not expected:
        return
    actual = str(payload.get(key) or "").strip()
    if actual and actual != expected:
        raise ValueError(f"{key} mismatch: expected {expected}, got {actual}")
    payload.setdefault(key, expected)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Merge retained topic feed payloads")
    parser.add_argument("--existing", required=True)
    parser.add_argument("--incoming", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--retain-limit", type=int, default=20)
    parser.add_argument("--room-id")
    parser.add_argument("--program-slug")
    parser.add_argument("--image-dir")
    parser.add_argument("--audio-dir")
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

    merged = merge_retained_feed(
        existing_payload,
        incoming_payload,
        retain_limit=args.retain_limit,
        image_dir=Path(args.image_dir) if args.image_dir else None,
        audio_dir=Path(args.audio_dir) if args.audio_dir else None,
    )
    atomic_write_json(args.output, merged)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
