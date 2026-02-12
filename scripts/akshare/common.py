from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def to_code(value: str) -> str:
    raw = str(value or "").strip().lower()
    if raw.startswith(("sh", "sz", "bj")):
        raw = raw[2:]
    return raw.zfill(6)


def to_onlytrade_symbol(code: str) -> str:
    normalized = to_code(code)
    if normalized.startswith("6"):
        return f"{normalized}.SH"
    return f"{normalized}.SZ"


def exchange_from_code(code: str) -> str:
    normalized = to_code(code)
    if normalized.startswith("6"):
        return "SSE"
    return "SZSE"


def ensure_parent_dir(file_path: str | Path) -> None:
    Path(file_path).parent.mkdir(parents=True, exist_ok=True)


def atomic_write_text(file_path: str | Path, content: str) -> None:
    target = Path(file_path)
    ensure_parent_dir(target)
    temp = target.with_suffix(target.suffix + ".tmp")
    temp.write_text(content, encoding="utf-8")
    temp.replace(target)


def atomic_write_json(file_path: str | Path, payload: Any) -> None:
    atomic_write_text(file_path, json.dumps(payload, ensure_ascii=False))


def read_json_or_default(file_path: str | Path, default: Any) -> Any:
    target = Path(file_path)
    if not target.exists():
        return default
    try:
        return json.loads(target.read_text(encoding="utf-8"))
    except Exception:
        return default
