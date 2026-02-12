from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Any
import sys

if __package__ is None or __package__ == "":
    sys.path.append(str(Path(__file__).resolve().parents[2]))

import akshare as ak

from scripts.akshare.common import (
    atomic_write_json,
    ensure_parent_dir,
    read_json_or_default,
    to_code,
)


DEFAULT_SYMBOLS = ["600519", "300750", "601318", "000001", "688981"]
DEFAULT_RAW_MINUTE_PATH = Path("data/live/akshare/raw_minute.jsonl")
DEFAULT_RAW_QUOTES_PATH = Path("data/live/akshare/raw_quotes.json")
DEFAULT_CHECKPOINT_PATH = Path("data/live/akshare/checkpoint.json")


def _as_float(value: Any, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return fallback


def _normalize_minute_rows(
    code: str, rows: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    out = []
    for row in rows:
        out.append(
            {
                "symbol_code": to_code(code),
                "time": str(row.get("时间") or row.get("time") or ""),
                "open": _as_float(row.get("开盘", row.get("open"))),
                "close": _as_float(row.get("收盘", row.get("close"))),
                "high": _as_float(row.get("最高", row.get("high"))),
                "low": _as_float(row.get("最低", row.get("low"))),
                "volume_lot": _as_float(row.get("成交量", row.get("volume_lot"))),
                "amount_cny": _as_float(row.get("成交额", row.get("amount_cny"))),
                "avg_price": _as_float(row.get("均价", row.get("avg_price"))),
                "source": "akshare.stock_zh_a_hist_min_em",
            }
        )
    return out


def fetch_minute_tail(code: str, tail_bars: int = 8) -> list[dict[str, Any]]:
    normalized = to_code(code)
    df = ak.stock_zh_a_hist_min_em(symbol=normalized, period="1", adjust="")
    rows = df.tail(max(1, int(tail_bars))).to_dict(orient="records")
    return _normalize_minute_rows(normalized, rows)


def fetch_quote_snapshot(code: str) -> dict[str, Any]:
    normalized = to_code(code)
    df = ak.stock_bid_ask_em(symbol=normalized)
    item_map = {str(row["item"]): row["value"] for _, row in df.iterrows()}
    return {
        "symbol_code": normalized,
        "latest": _as_float(item_map.get("最新")),
        "pct_change": _as_float(item_map.get("涨幅")),
        "turnover_cny": _as_float(item_map.get("金额")),
        "volume_lot": _as_float(item_map.get("总手")),
        "open": _as_float(item_map.get("今开")),
        "high": _as_float(item_map.get("最高")),
        "low": _as_float(item_map.get("最低")),
        "prev_close": _as_float(item_map.get("昨收")),
        "source": "akshare.stock_bid_ask_em",
    }


def run_collection(
    symbols: list[str],
    raw_minute_path: Path = DEFAULT_RAW_MINUTE_PATH,
    raw_quotes_path: Path = DEFAULT_RAW_QUOTES_PATH,
    checkpoint_path: Path = DEFAULT_CHECKPOINT_PATH,
    tail_bars: int = 8,
) -> dict[str, Any]:
    checkpoint = read_json_or_default(checkpoint_path, {"last_time_by_symbol": {}})
    last_time_by_symbol = dict(checkpoint.get("last_time_by_symbol") or {})

    ensure_parent_dir(raw_minute_path)
    appended = 0
    quote_rows: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    with raw_minute_path.open("a", encoding="utf-8") as writer:
        for symbol in symbols:
            code = to_code(symbol)

            try:
                minute_rows = fetch_minute_tail(code, tail_bars=tail_bars)
                for row in minute_rows:
                    last_seen = str(last_time_by_symbol.get(code) or "")
                    current = row["time"]
                    if not current:
                        continue
                    if last_seen and current <= last_seen:
                        continue

                    row["ingest_ts"] = datetime.now().isoformat(timespec="seconds")
                    writer.write(json.dumps(row, ensure_ascii=False) + "\n")
                    appended += 1
                    last_time_by_symbol[code] = current
            except Exception as error:
                errors.append(
                    {"symbol_code": code, "stage": "minute", "error": str(error)}
                )

            try:
                quote = fetch_quote_snapshot(code)
                quote["ingest_ts"] = datetime.now().isoformat(timespec="seconds")
                quote_rows.append(quote)
            except Exception as error:
                errors.append(
                    {"symbol_code": code, "stage": "quote", "error": str(error)}
                )

    atomic_write_json(
        raw_quotes_path,
        {
            "schema_version": "akshare.raw.quotes.v1",
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "rows": quote_rows,
            "errors": errors,
        },
    )

    atomic_write_json(
        checkpoint_path,
        {
            "schema_version": "akshare.collector.checkpoint.v1",
            "updated_at": datetime.now().isoformat(timespec="seconds"),
            "last_time_by_symbol": last_time_by_symbol,
        },
    )

    return {
        "symbols_requested": len(symbols),
        "minute_rows_appended": appended,
        "quotes_collected": len(quote_rows),
        "errors": errors,
        "raw_minute_path": str(raw_minute_path),
        "raw_quotes_path": str(raw_quotes_path),
        "checkpoint_path": str(checkpoint_path),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect AKShare raw stock data")
    parser.add_argument(
        "--symbols",
        default=",".join(DEFAULT_SYMBOLS),
        help="Comma-separated stock codes",
    )
    parser.add_argument(
        "--tail-bars",
        type=int,
        default=8,
        help="How many recent minute bars to fetch per symbol",
    )
    parser.add_argument("--raw-minute-path", default=str(DEFAULT_RAW_MINUTE_PATH))
    parser.add_argument("--raw-quotes-path", default=str(DEFAULT_RAW_QUOTES_PATH))
    parser.add_argument("--checkpoint-path", default=str(DEFAULT_CHECKPOINT_PATH))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    symbols = [to_code(item) for item in args.symbols.split(",") if item.strip()]

    summary = run_collection(
        symbols=symbols,
        raw_minute_path=Path(args.raw_minute_path),
        raw_quotes_path=Path(args.raw_quotes_path),
        checkpoint_path=Path(args.checkpoint_path),
        tail_bars=args.tail_bars,
    )
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
