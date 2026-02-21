#!/usr/bin/env python3
"""Check freshness of live market data files.

Usage:
  python scripts/ops/check_live_data_freshness.py
  python scripts/ops/check_live_data_freshness.py --repo-root /opt/onlytrade
  python scripts/ops/check_live_data_freshness.py \
    --file data/live/onlytrade/frames.1m.json:180:required \
    --file data/live/onlytrade/news_digest.cn-a.json:43200:required
"""

from __future__ import annotations

import argparse
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class FileCheck:
    path: str
    max_age_sec: int
    required: bool


def parse_file_check(raw: str) -> FileCheck:
    parts = [p.strip() for p in str(raw or "").split(":")]
    if len(parts) < 2:
        raise argparse.ArgumentTypeError(
            "--file expects path:max_age_sec[:required|optional]"
        )

    path = parts[0]
    if not path:
        raise argparse.ArgumentTypeError("--file path is empty")

    try:
        max_age_sec = int(parts[1])
    except ValueError as exc:
        raise argparse.ArgumentTypeError("--file max_age_sec must be integer") from exc

    if max_age_sec < 0:
        raise argparse.ArgumentTypeError("--file max_age_sec must be >= 0")

    required = True
    if len(parts) >= 3 and parts[2]:
        mode = parts[2].lower()
        if mode in {"required", "req", "true", "1", "yes"}:
            required = True
        elif mode in {"optional", "opt", "false", "0", "no"}:
            required = False
        else:
            raise argparse.ArgumentTypeError(
                "--file third field must be required|optional"
            )

    return FileCheck(path=path, max_age_sec=max_age_sec, required=required)


def default_checks() -> list[FileCheck]:
    return [
        FileCheck("data/live/onlytrade/frames.1m.json", 180, True),
        FileCheck("data/live/onlytrade/market_overview.cn-a.json", 180, True),
        FileCheck("data/live/onlytrade/news_digest.cn-a.json", 12 * 60 * 60, True),
        FileCheck("data/live/onlytrade/market_breadth.cn-a.json", 180, True),
        FileCheck("data/live/us/frames.us.json", 180, False),
        FileCheck("data/live/onlytrade/market_overview.us.json", 180, False),
        FileCheck("data/live/onlytrade/news_digest.us.json", 12 * 60 * 60, False),
        FileCheck("data/live/onlytrade/market_breadth.us.json", 180, False),
    ]


def extract_payload_freshness(payload: Any) -> dict[str, Any]:
    info: dict[str, Any] = {
        "payload_schema": None,
        "payload_generated_at": None,
        "payload_latest_ts_ms": None,
    }

    if not isinstance(payload, dict):
        return info

    info["payload_schema"] = payload.get("schema_version")
    generated_at = payload.get("generated_at")
    if isinstance(generated_at, str) and generated_at:
        info["payload_generated_at"] = generated_at

    frames = payload.get("frames")
    if isinstance(frames, list) and frames:
        last = frames[-1]
        if isinstance(last, dict):
            ts_ms = last.get("event_ts_ms")
            if isinstance(ts_ms, (int, float)):
                info["payload_latest_ts_ms"] = int(ts_ms)

    return info


def check_one(repo_root: Path, spec: FileCheck, now: float) -> dict[str, Any]:
    fp = (repo_root / spec.path).resolve()
    row: dict[str, Any] = {
        "path": spec.path,
        "absolute_path": str(fp),
        "required": spec.required,
        "max_age_sec": spec.max_age_sec,
        "exists": False,
        "ok": False,
        "stale": True,
        "age_sec": None,
        "mtime_epoch": None,
        "size_bytes": None,
        "error": None,
    }

    if not fp.exists():
        row["error"] = "missing"
        return row

    try:
        st = fp.stat()
        age_sec = max(0.0, now - st.st_mtime)
        stale = age_sec > float(spec.max_age_sec)
        row.update(
            {
                "exists": True,
                "age_sec": round(age_sec, 3),
                "mtime_epoch": st.st_mtime,
                "size_bytes": st.st_size,
                "stale": stale,
                "ok": not stale,
            }
        )

        payload_info: dict[str, Any] = {}
        if fp.suffix.lower() == ".json":
            try:
                with fp.open("r", encoding="utf-8") as f:
                    payload = json.load(f)
                payload_info = extract_payload_freshness(payload)
            except Exception as exc:  # pragma: no cover - best effort metadata
                payload_info = {"payload_parse_error": str(exc)}
        if payload_info:
            row.update(payload_info)
    except Exception as exc:
        row["error"] = str(exc)

    return row


def main() -> int:
    parser = argparse.ArgumentParser(description="Check freshness of live data files.")
    parser.add_argument(
        "--repo-root",
        default=None,
        help="Repo root path (default: infer from script location)",
    )
    parser.add_argument(
        "--file",
        action="append",
        type=parse_file_check,
        default=[],
        help="Freshness check spec path:max_age_sec[:required|optional]",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit non-zero when any required check fails",
    )
    args = parser.parse_args()

    if args.repo_root:
        repo_root = Path(args.repo_root).resolve()
    else:
        repo_root = Path(__file__).resolve().parents[2]

    specs: list[FileCheck] = args.file or default_checks()
    now = time.time()
    checks = [check_one(repo_root, spec, now) for spec in specs]

    required_fails = [row for row in checks if row["required"] and not row["ok"]]
    optional_fails = [row for row in checks if (not row["required"]) and not row["ok"]]
    payload = {
        "ts_ms": int(now * 1000),
        "repo_root": str(repo_root),
        "ok": len(required_fails) == 0,
        "required_fail_count": len(required_fails),
        "optional_fail_count": len(optional_fails),
        "checks": checks,
    }

    print(json.dumps(payload, ensure_ascii=False))

    if args.strict and required_fails:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
