from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import sys
from zoneinfo import ZoneInfo

if __package__ is None or __package__ == "":
    sys.path.append(str(Path(__file__).resolve().parents[2]))

import akshare as ak

from scripts.akshare.common import atomic_write_json


SH_TZ = ZoneInfo("Asia/Shanghai")


def _to_float(value) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except Exception:
        return None


def _ret_from_series(values: list[float], lookback: int) -> float | None:
    n = int(lookback)
    if len(values) <= n:
        return None
    latest = values[-1]
    base = values[-1 - n]
    if base == 0:
        return None
    return round(latest / base - 1.0, 6)


def _sh_day_key(now_ms: int) -> str:
    return datetime.fromtimestamp(now_ms / 1000.0, tz=SH_TZ).strftime("%Y-%m-%d")


@dataclass
class BenchmarkRow:
    symbol: str
    name: str
    ret_5: float | None
    ret_20: float | None
    last_bar_ts_ms: int | None


def _index_minute_benchmark(
    symbol: str, name: str, start_dt: str, end_dt: str
) -> BenchmarkRow:
    # ak.index_zh_a_hist_min_em returns columns with Chinese names.
    # Use unicode escapes to keep source ASCII-only.
    col_time = "\u65f6\u95f4"  # 时间
    col_close = "\u6536\u76d8"  # 收盘

    try:
        df = ak.index_zh_a_hist_min_em(
            symbol=symbol, period="1", start_date=start_dt, end_date=end_dt
        )
    except Exception:
        return BenchmarkRow(
            symbol=symbol, name=name, ret_5=None, ret_20=None, last_bar_ts_ms=None
        )

    if df is None or df.empty:
        return BenchmarkRow(
            symbol=symbol, name=name, ret_5=None, ret_20=None, last_bar_ts_ms=None
        )

    closes: list[float] = []
    for v in df[col_close].tolist():
        f = _to_float(v)
        if f is not None:
            closes.append(f)

    last_bar_ts_ms: int | None = None
    try:
        last_time = str(df[col_time].tolist()[-1])
        # Expected format: YYYY-MM-DD HH:MM:SS
        ts = datetime.fromisoformat(last_time)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=SH_TZ)
        else:
            ts = ts.astimezone(SH_TZ)
        last_bar_ts_ms = int(ts.timestamp() * 1000) + 60_000
    except Exception:
        last_bar_ts_ms = None

    return BenchmarkRow(
        symbol=symbol,
        name=name,
        ret_5=_ret_from_series(closes, 5),
        ret_20=_ret_from_series(closes, 20),
        last_bar_ts_ms=last_bar_ts_ms,
    )


def _industry_heatmap(limit: int = 10) -> list[dict]:
    # ak.stock_board_industry_name_em returns industry board rows with percent change.
    col_name = "\u677f\u5757\u540d\u79f0"  # 板块名称
    col_pct = "\u6da8\u8dcc\u5e45"  # 涨跌幅
    col_code = "\u677f\u5757\u4ee3\u7801"  # 板块代码

    try:
        df = ak.stock_board_industry_name_em()
    except Exception:
        return []

    if df is None or df.empty:
        return []

    rows = []
    for _, r in df.iterrows():
        name = str(r.get(col_name, "")).strip()
        code = str(r.get(col_code, "")).strip()
        pct = _to_float(r.get(col_pct))
        if not name:
            continue
        ret = None
        if pct is not None:
            ret = round(pct / 100.0, 6)
        rows.append(
            {
                "name": name,
                "code": code or None,
                # Snapshot pct; reuse for both lookbacks.
                "ret_5": ret,
                "ret_20": ret,
            }
        )

    rows_sorted = sorted(rows, key=lambda x: (x.get("ret_20") or 0), reverse=True)
    if limit <= 0:
        return rows_sorted
    return rows_sorted[:limit]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--canonical-path", default="data/live/onlytrade/market_overview.cn-a.json"
    )
    parser.add_argument("--benchmarks", default="000001,399001,399006,000300,000905")
    parser.add_argument("--limit-industries", type=int, default=12)
    args = parser.parse_args()

    now = datetime.now(SH_TZ)
    day_key = now.strftime("%Y-%m-%d")
    # Scope to today's session for speed.
    start_dt = f"{day_key} 09:30:00"
    end_dt = f"{day_key} 15:10:00"

    bench_codes = [
        c.strip() for c in str(args.benchmarks or "").split(",") if c.strip()
    ]
    bench_name = {
        "000001": "上证指数",
        "399001": "深证成指",
        "399006": "创业板指",
        "000300": "沪深300",
        "000905": "中证500",
    }

    benchmarks: list[dict] = []
    for code in bench_codes:
        row = _index_minute_benchmark(
            code, bench_name.get(code, code), start_dt, end_dt
        )
        benchmarks.append(
            {
                "symbol": row.symbol,
                "name": row.name,
                "ret_5": row.ret_5,
                "ret_20": row.ret_20,
                "last_bar_ts_ms": row.last_bar_ts_ms,
            }
        )

    industries = _industry_heatmap(limit=int(args.limit_industries or 12))

    payload = {
        "schema_version": "market.overview.v1",
        "market": "CN-A",
        "mode": "real",
        "provider": "akshare",
        "as_of_ts_ms": int(now.timestamp() * 1000),
        "benchmarks": benchmarks,
        "sectors": industries,
        "summary": "",
    }

    atomic_write_json(args.canonical_path, payload)
    print(
        json.dumps(
            {
                "ok": True,
                "output_path": args.canonical_path,
                "benchmarks": len(benchmarks),
                "sectors": len(industries),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
