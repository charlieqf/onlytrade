from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
from typing import Any
import sys

if __package__ is None or __package__ == "":
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from scripts.akshare.common import (
    atomic_write_json,
    exchange_from_code,
    to_code,
    to_onlytrade_symbol,
)


SH_TZ = ZoneInfo("Asia/Shanghai")
DEFAULT_RAW_MINUTE_PATH = Path("data/live/akshare/raw_minute.jsonl")
DEFAULT_CANONICAL_PATH = Path("data/live/onlytrade/frames.1m.json")


def _as_float(value: Any, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return fallback


def _parse_start_ts_ms(value: str) -> int:
    dt = datetime.strptime(str(value), "%Y-%m-%d %H:%M:%S").replace(tzinfo=SH_TZ)
    return int(dt.timestamp() * 1000)


def map_row_to_frame(code: str, row: dict[str, Any], seq: int = 1) -> dict[str, Any]:
    normalized = to_code(code)
    symbol = to_onlytrade_symbol(normalized)
    time_str = str(row.get("时间") or row.get("time") or "")
    start_ts_ms = _parse_start_ts_ms(time_str)
    end_ts_ms = start_ts_ms + 60_000

    open_price = _as_float(row.get("开盘", row.get("open")))
    close_price = _as_float(row.get("收盘", row.get("close")), open_price)
    high_price = _as_float(
        row.get("最高", row.get("high")), max(open_price, close_price)
    )
    low_price = _as_float(row.get("最低", row.get("low")), min(open_price, close_price))

    volume_lot = _as_float(row.get("成交量", row.get("volume_lot")))
    volume_shares = int(round(volume_lot * 100))
    turnover_cny = _as_float(
        row.get("成交额", row.get("amount_cny")), close_price * volume_shares
    )
    vwap = turnover_cny / volume_shares if volume_shares > 0 else close_price

    return {
        "schema_version": "market.bar.v1",
        "market": "CN-A",
        "mode": "real",
        "provider": "akshare",
        "feed": "bars",
        "seq": int(seq),
        "event_ts_ms": end_ts_ms,
        "ingest_ts_ms": end_ts_ms + 250,
        "instrument": {
            "symbol": symbol,
            "exchange": exchange_from_code(normalized),
            "timezone": "Asia/Shanghai",
            "currency": "CNY",
        },
        "interval": "1m",
        "window": {
            "start_ts_ms": start_ts_ms,
            "end_ts_ms": end_ts_ms,
            "trading_day": str(time_str)[:10],
        },
        "session": {
            "phase": "continuous_am",
            "is_halt": False,
            "is_partial": False,
        },
        "bar": {
            "open": round(open_price, 4),
            "high": round(high_price, 4),
            "low": round(low_price, 4),
            "close": round(close_price, 4),
            "volume_shares": volume_shares,
            "turnover_cny": round(turnover_cny, 2),
            "vwap": round(vwap, 4),
        },
    }


def convert_records_to_frames(
    records: list[dict[str, Any]], max_frames: int = 20000
) -> list[dict[str, Any]]:
    deduped: dict[tuple[str, int], dict[str, Any]] = {}

    for idx, row in enumerate(records):
        code = to_code(row.get("symbol_code") or row.get("code") or "")
        time_str = str(row.get("time") or row.get("时间") or "")
        if not code or not time_str:
            continue
        frame = map_row_to_frame(code, row, seq=idx + 1)
        key = (frame["instrument"]["symbol"], frame["window"]["start_ts_ms"])
        deduped[key] = frame

    frames = list(deduped.values())
    frames.sort(
        key=lambda item: (item["window"]["start_ts_ms"], item["instrument"]["symbol"])
    )

    if len(frames) > max_frames:
        frames = frames[-max_frames:]

    for i, frame in enumerate(frames, start=1):
        frame["seq"] = i

    return frames


def run_conversion(
    raw_minute_path: Path = DEFAULT_RAW_MINUTE_PATH,
    output_path: Path = DEFAULT_CANONICAL_PATH,
    max_frames: int = 20000,
) -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    if raw_minute_path.exists():
        with raw_minute_path.open("r", encoding="utf-8") as reader:
            for line in reader:
                text = line.strip()
                if not text:
                    continue
                try:
                    records.append(json.loads(text))
                except Exception:
                    continue

    frames = convert_records_to_frames(records, max_frames=max_frames)
    payload = {
        "schema_version": "market.frames.v1",
        "market": "CN-A",
        "mode": "real",
        "provider": "akshare",
        "frames": frames,
    }
    atomic_write_json(output_path, payload)

    return {
        "records_read": len(records),
        "canonical_frames": len(frames),
        "output_path": str(output_path),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert AKShare raw data to OnlyTrade canonical frames"
    )
    parser.add_argument("--raw-minute-path", default=str(DEFAULT_RAW_MINUTE_PATH))
    parser.add_argument("--output-path", default=str(DEFAULT_CANONICAL_PATH))
    parser.add_argument("--max-frames", type=int, default=20000)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    summary = run_conversion(
        raw_minute_path=Path(args.raw_minute_path),
        output_path=Path(args.output_path),
        max_frames=max(1000, int(args.max_frames)),
    )
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
