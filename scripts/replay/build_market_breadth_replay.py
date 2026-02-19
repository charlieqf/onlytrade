from __future__ import annotations

import argparse
import json
from pathlib import Path
import time


def _to_float(value):
    try:
        if value is None:
            return None
        return float(value)
    except Exception:
        return None


def _classify_change(current_close, prev_close) -> int:
    cur = _to_float(current_close)
    prev = _to_float(prev_close)
    if cur is None or prev is None:
        return 0
    if cur > prev:
        return 1
    if cur < prev:
        return -1
    return 0


def _load_frames(frames_path: Path) -> list[dict]:
    payload = json.loads(frames_path.read_text(encoding="utf-8"))
    rows = payload.get("frames") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return []
    return [x for x in rows if isinstance(x, dict)]


def _build_series(frames: list[dict]) -> list[dict]:
    by_symbol: dict[str, list[dict]] = {}
    for frame in frames:
        if str(frame.get("interval") or "") != "1m":
            continue
        instrument = frame.get("instrument") or {}
        window = frame.get("window") or {}
        symbol = str(instrument.get("symbol") or "").strip().upper()
        start_ts_ms = window.get("start_ts_ms")
        if not symbol or not isinstance(start_ts_ms, (int, float)):
            continue
        by_symbol.setdefault(symbol, []).append(frame)

    counts_by_ts: dict[int, dict] = {}
    for rows in by_symbol.values():
        rows.sort(
            key=lambda row: float((row.get("window") or {}).get("start_ts_ms") or 0)
        )
        prev_close = None
        for frame in rows:
            window = frame.get("window") or {}
            bar = frame.get("bar") or {}
            start_ts_ms = window.get("start_ts_ms")
            if not isinstance(start_ts_ms, (int, float)):
                continue
            ts_ms = int(start_ts_ms)
            close = _to_float(bar.get("close"))
            if close is None:
                continue

            change = 0 if prev_close is None else _classify_change(close, prev_close)
            row = counts_by_ts.setdefault(
                ts_ms,
                {
                    "ts_ms": ts_ms,
                    "trading_day": str(window.get("trading_day") or ""),
                    "advancers": 0,
                    "decliners": 0,
                    "unchanged": 0,
                },
            )
            if change > 0:
                row["advancers"] += 1
            elif change < 0:
                row["decliners"] += 1
            else:
                row["unchanged"] += 1

            prev_close = close

    series: list[dict] = []
    for ts_ms in sorted(counts_by_ts.keys()):
        row = counts_by_ts[ts_ms]
        adv = int(row["advancers"])
        dec = int(row["decliners"])
        unc = int(row["unchanged"])
        total = adv + dec + unc
        advancer_ratio = round(adv / total, 6) if total > 0 else None
        red_blue_ratio = round(adv / dec, 6) if dec > 0 else None
        series.append(
            {
                "ts_ms": ts_ms,
                "trading_day": row["trading_day"],
                "breadth": {
                    "advancers": adv,
                    "decliners": dec,
                    "unchanged": unc,
                    "total": total,
                    "advancer_ratio": advancer_ratio,
                    "red_blue_ratio": red_blue_ratio,
                },
            }
        )
    return series


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--frames-path",
        default="onlytrade-web/public/replay/cn-a/latest/frames.1m.json",
    )
    parser.add_argument(
        "--output-path",
        default="onlytrade-web/public/replay/cn-a/latest/market_breadth.1m.json",
    )
    args = parser.parse_args()

    frames_path = Path(args.frames_path)
    output_path = Path(args.output_path)
    if not frames_path.exists():
        raise FileNotFoundError(f"frames file not found: {frames_path}")

    frames = _load_frames(frames_path)
    series = _build_series(frames)

    market = "CN-A"
    if frames:
        market = str(frames[0].get("market") or "CN-A")

    day_key = ""
    if series:
        day_key = str(series[-1].get("trading_day") or "")

    payload = {
        "schema_version": "market.breadth.replay.v1",
        "market": market,
        "mode": "replay",
        "provider": "derived_from_frames",
        "source_frames_path": str(frames_path),
        "day_key": day_key,
        "point_count": len(series),
        "generated_at_ts_ms": time.time_ns() // 1_000_000,
        "series": series,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    print(
        json.dumps(
            {
                "ok": True,
                "frames_path": str(frames_path),
                "output_path": str(output_path),
                "point_count": len(series),
                "day_key": day_key,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
