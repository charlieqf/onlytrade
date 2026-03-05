import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


REPO_ROOT = Path(__file__).resolve().parent
DEFAULT_POLICY_PATH = Path(
    os.environ.get("ONLYTRADE_SENSITIVE_POLICY_PATH")
    or (REPO_ROOT / "config" / "sensitive_topic_policy.json")
)
DEFAULT_AUDIT_PATH = Path(
    os.environ.get("ONLYTRADE_SENSITIVE_AUDIT_PATH")
    or (REPO_ROOT / "data" / "live" / "onlytrade" / "sensitive_filter_audit.jsonl")
)


def _default_policy() -> Dict[str, Any]:
    return {
        "schema_version": "sensitive.topic.policy.v1",
        "default_mode": "off",
        "rooms": {
            "t_015": {"mode": "hard_block"},
        },
        "allowlist": [],
        "categories": [],
    }


_policy_cache: Dict[str, Any] = {}
_policy_path_cache: Optional[Path] = None
_policy_mtime_cache: Optional[float] = None


def load_sensitive_topic_policy(force: bool = False) -> Dict[str, Any]:
    global _policy_cache, _policy_path_cache, _policy_mtime_cache

    path = DEFAULT_POLICY_PATH
    if force:
        _policy_cache = {}
        _policy_mtime_cache = None
        _policy_path_cache = None

    try:
        stat = path.stat()
        mtime = float(stat.st_mtime)
    except Exception:
        stat = None
        mtime = None

    if (
        _policy_cache
        and _policy_path_cache == path
        and _policy_mtime_cache is not None
        and mtime is not None
        and _policy_mtime_cache == mtime
    ):
        return _policy_cache

    merged = _default_policy()
    if stat is not None:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                merged.update(payload)
        except Exception:
            pass

    merged["default_mode"] = str(merged.get("default_mode") or "off").strip().lower()
    if merged["default_mode"] not in {"off", "hard_block"}:
        merged["default_mode"] = "off"

    rooms = merged.get("rooms") if isinstance(merged.get("rooms"), dict) else {}
    normalized_rooms: Dict[str, Dict[str, Any]] = {}
    for raw_room_id, cfg in rooms.items():
        room_id = str(raw_room_id or "").strip().lower()
        if not room_id:
            continue
        row = cfg if isinstance(cfg, dict) else {}
        mode = str(row.get("mode") or merged["default_mode"] or "off").strip().lower()
        if mode not in {"off", "hard_block"}:
            mode = "off"
        normalized_rooms[room_id] = {"mode": mode}
    merged["rooms"] = normalized_rooms

    allowlist = (
        merged.get("allowlist") if isinstance(merged.get("allowlist"), list) else []
    )
    merged["allowlist"] = [
        str(item or "").strip().lower() for item in allowlist if str(item or "").strip()
    ]

    categories = (
        merged.get("categories") if isinstance(merged.get("categories"), list) else []
    )
    normalized_categories: List[Dict[str, Any]] = []
    for row in categories:
        if not isinstance(row, dict):
            continue
        category_id = str(row.get("id") or "").strip().lower()
        if not category_id:
            continue
        label = str(row.get("label") or category_id).strip() or category_id
        keywords = row.get("keywords") if isinstance(row.get("keywords"), list) else []
        normalized_keywords = [
            str(token or "").strip().lower()
            for token in keywords
            if str(token or "").strip()
        ]
        if not normalized_keywords:
            continue
        normalized_categories.append(
            {
                "id": category_id,
                "label": label,
                "keywords": normalized_keywords,
            }
        )
    merged["categories"] = normalized_categories

    _policy_cache = merged
    _policy_path_cache = path
    _policy_mtime_cache = mtime
    return merged


def resolve_room_filter_mode(
    room_id: str, policy: Optional[Dict[str, Any]] = None
) -> str:
    active = policy if isinstance(policy, dict) else load_sensitive_topic_policy()
    default_mode = str(active.get("default_mode") or "off").strip().lower()
    if default_mode not in {"off", "hard_block"}:
        default_mode = "off"
    safe_room_id = str(room_id or "").strip().lower()
    if not safe_room_id:
        return default_mode
    rooms = active.get("rooms") if isinstance(active.get("rooms"), dict) else {}
    room_cfg = rooms.get(safe_room_id) if isinstance(rooms, dict) else None
    if not isinstance(room_cfg, dict):
        return default_mode
    mode = str(room_cfg.get("mode") or default_mode).strip().lower()
    return mode if mode in {"off", "hard_block"} else default_mode


def evaluate_sensitive_text(
    value: Any,
    *,
    room_id: str = "",
    policy: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    active = policy if isinstance(policy, dict) else load_sensitive_topic_policy()
    mode = resolve_room_filter_mode(room_id, active)
    text = str(value or "").strip()
    normalized = text.lower()
    if not text:
        return {"mode": mode, "blocked": False, "categories": [], "matches": []}
    if mode != "hard_block":
        return {"mode": mode, "blocked": False, "categories": [], "matches": []}

    allowlist = (
        active.get("allowlist") if isinstance(active.get("allowlist"), list) else []
    )
    for token in allowlist:
        keyword = str(token or "").strip().lower()
        if keyword and keyword in normalized:
            return {"mode": mode, "blocked": False, "categories": [], "matches": []}

    matches: List[Dict[str, str]] = []
    categories_seen = set()
    for row in (
        active.get("categories") if isinstance(active.get("categories"), list) else []
    ):
        if not isinstance(row, dict):
            continue
        category_id = str(row.get("id") or "").strip().lower()
        if not category_id:
            continue
        for token in (
            row.get("keywords") if isinstance(row.get("keywords"), list) else []
        ):
            keyword = str(token or "").strip().lower()
            if not keyword:
                continue
            if keyword in normalized:
                matches.append({"category": category_id, "token": keyword})
                categories_seen.add(category_id)
                break

    blocked = bool(matches)
    return {
        "mode": mode,
        "blocked": blocked,
        "categories": sorted(categories_seen),
        "matches": matches,
    }


def contains_sensitive_topic(
    value: Any,
    *,
    room_id: str = "",
    policy: Optional[Dict[str, Any]] = None,
) -> bool:
    result = evaluate_sensitive_text(value, room_id=room_id, policy=policy)
    return bool(result.get("blocked"))


def append_sensitive_audit_samples(
    samples: List[Dict[str, Any]],
    *,
    source: str,
    room_id: str,
    max_rows: int = 200,
    audit_path: Optional[str] = None,
) -> None:
    if not samples:
        return

    target = Path(audit_path) if audit_path else DEFAULT_AUDIT_PATH
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
    except Exception:
        return

    ts_iso = (
        datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    )
    new_lines: List[str] = []
    for sample in samples[: max(1, min(40, int(max_rows // 2) or 1))]:
        if not isinstance(sample, dict):
            continue
        row = {
            "ts": ts_iso,
            "source": str(source or "").strip() or "unknown",
            "room_id": str(room_id or "").strip().lower(),
            "title": str(sample.get("title") or "").strip()[:220] or None,
            "summary": str(sample.get("summary") or "").strip()[:220] or None,
            "text": str(sample.get("text") or "").strip()[:220] or None,
            "categories": [
                str(cat or "").strip().lower()
                for cat in (sample.get("categories") or [])
                if str(cat or "").strip()
            ][:6],
            "matches": [
                {
                    "category": str(match.get("category") or "").strip().lower(),
                    "token": str(match.get("token") or "").strip()[:48],
                }
                for match in (sample.get("matches") or [])
                if isinstance(match, dict)
            ][:8],
        }
        new_lines.append(json.dumps(row, ensure_ascii=False))

    if not new_lines:
        return

    existing_lines: List[str] = []
    try:
        if target.exists() and target.is_file():
            with target.open("r", encoding="utf-8") as reader:
                existing_lines = [line.rstrip("\n") for line in reader if line.strip()]
    except Exception:
        existing_lines = []

    keep = max(0, int(max_rows) - len(new_lines))
    trimmed = existing_lines[-keep:] if keep > 0 else []
    final_lines = trimmed + new_lines
    tmp_path = target.with_suffix(target.suffix + ".tmp")
    try:
        with tmp_path.open("w", encoding="utf-8") as writer:
            for line in final_lines:
                writer.write(line + "\n")
        tmp_path.replace(target)
    except Exception:
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except Exception:
            pass
