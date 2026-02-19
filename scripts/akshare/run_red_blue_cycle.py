from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
import sys
from zoneinfo import ZoneInfo

if __package__ is None or __package__ == "":
    sys.path.append(str(Path(__file__).resolve().parents[2]))

try:
    import akshare as ak  # type: ignore
except Exception:
    ak = None

from scripts.akshare.common import atomic_write_json


SH_TZ = ZoneInfo("Asia/Shanghai")


def _to_float(value) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except Exception:
        return None


def _compute_breadth() -> dict:
    if ak is None:
        return {
            "advancers": None,
            "decliners": None,
            "unchanged": None,
            "total": None,
            "advancer_ratio": None,
            "red_blue_ratio": None,
            "error": "akshare_unavailable",
        }

    # ak.stock_zh_a_spot_em columns are Chinese headers.
    col_pct = "\u6da8\u8dcc\u5e45"  # 涨跌幅

    try:
        df = ak.stock_zh_a_spot_em()
    except Exception:
        return {
            "advancers": None,
            "decliners": None,
            "unchanged": None,
            "total": None,
            "advancer_ratio": None,
            "red_blue_ratio": None,
            "error": "spot_fetch_failed",
        }

    if df is None or df.empty:
        return {
            "advancers": None,
            "decliners": None,
            "unchanged": None,
            "total": None,
            "advancer_ratio": None,
            "red_blue_ratio": None,
            "error": "spot_empty",
        }

    advancers = 0
    decliners = 0
    unchanged = 0

    for value in df[col_pct].tolist():
        pct = _to_float(value)
        if pct is None:
            continue
        if pct > 0:
            advancers += 1
        elif pct < 0:
            decliners += 1
        else:
            unchanged += 1

    total = advancers + decliners + unchanged
    advancer_ratio = round(advancers / total, 6) if total > 0 else None
    red_blue_ratio = round(advancers / decliners, 6) if decliners > 0 else None

    return {
        "advancers": advancers,
        "decliners": decliners,
        "unchanged": unchanged,
        "total": total,
        "advancer_ratio": advancer_ratio,
        "red_blue_ratio": red_blue_ratio,
        "error": None,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--canonical-path", default="data/live/onlytrade/market_breadth.cn-a.json"
    )
    args = parser.parse_args()

    now = datetime.now(SH_TZ)
    breadth = _compute_breadth()

    payload = {
        "schema_version": "market.breadth.v1",
        "market": "CN-A",
        "mode": "real",
        "provider": "akshare" if ak is not None else "none",
        "day_key": now.strftime("%Y-%m-%d"),
        "as_of_ts_ms": int(now.timestamp() * 1000),
        "breadth": {
            "advancers": breadth.get("advancers"),
            "decliners": breadth.get("decliners"),
            "unchanged": breadth.get("unchanged"),
            "total": breadth.get("total"),
            "advancer_ratio": breadth.get("advancer_ratio"),
            "red_blue_ratio": breadth.get("red_blue_ratio"),
        },
        "summary": (
            f"Red {breadth['advancers']} / Blue {breadth['decliners']} / Flat {breadth['unchanged']}"
            if breadth.get("advancers") is not None
            and breadth.get("decliners") is not None
            else ""
        ),
        "error": breadth.get("error"),
    }

    atomic_write_json(args.canonical_path, payload)
    print(
        json.dumps(
            {
                "ok": True,
                "output_path": args.canonical_path,
                "breadth": payload.get("breadth"),
                "error": payload.get("error"),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
