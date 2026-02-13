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
MIN_RECOVERY_BARS = 240


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


def _normalize_minute_rows_from_minute_api(
    code: str, rows: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    out = []
    for row in rows:
        close_price = _as_float(row.get("close"))
        out.append(
            {
                "symbol_code": to_code(code),
                "time": str(row.get("day") or row.get("time") or ""),
                "open": _as_float(row.get("open")),
                "close": close_price,
                "high": _as_float(row.get("high"), close_price),
                "low": _as_float(row.get("low"), close_price),
                "volume_lot": _as_float(row.get("volume")),
                "amount_cny": _as_float(row.get("amount")),
                "avg_price": _as_float(row.get("avg_price"), close_price),
                "source": "akshare.stock_zh_a_minute",
            }
        )
    return out


def _to_prefixed_symbol(code: str) -> str:
    normalized = to_code(code)
    if normalized.startswith(("5", "6", "9")):
        return f"sh{normalized}"
    return f"sz{normalized}"


def _normalize_spot_row_to_snapshot(row: dict[str, Any]) -> dict[str, Any]:
    code = to_code(str(row.get("代码") or row.get("code") or ""))
    return {
        "symbol_code": code,
        "latest": _as_float(row.get("最新价") or row.get("latest")),
        "pct_change": _as_float(row.get("涨跌幅") or row.get("pct_change")),
        "turnover_cny": _as_float(row.get("成交额") or row.get("turnover_cny")),
        "volume_lot": _as_float(row.get("成交量") or row.get("volume_lot")),
        "open": _as_float(row.get("今开") or row.get("open")),
        "high": _as_float(row.get("最高") or row.get("high")),
        "low": _as_float(row.get("最低") or row.get("low")),
        "prev_close": _as_float(row.get("昨收") or row.get("prev_close")),
        "source": "akshare.stock_zh_a_spot",
    }


def load_spot_quote_map() -> dict[str, dict[str, Any]]:
    df = ak.stock_zh_a_spot()
    rows = df.to_dict(orient="records")

    quote_map: dict[str, dict[str, Any]] = {}
    for row in rows:
        snapshot = _normalize_spot_row_to_snapshot(row)
        code = str(snapshot.get("symbol_code") or "")
        if code:
            quote_map[code] = snapshot
    return quote_map


def fetch_quote_snapshot_from_spot_map(
    code: str, spot_quote_map: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    normalized = to_code(code)
    snapshot = spot_quote_map.get(normalized)
    if snapshot is None:
        raise KeyError(f"spot quote not found for {normalized}")
    return dict(snapshot)


def build_quote_snapshot_from_minute_row(
    code: str, minute_row: dict[str, Any]
) -> dict[str, Any]:
    normalized = to_code(code)
    open_price = _as_float(minute_row.get("open"))
    close_price = _as_float(minute_row.get("close"), open_price)
    prev_close = _as_float(minute_row.get("prev_close"), open_price)
    return {
        "symbol_code": normalized,
        "latest": close_price,
        "pct_change": 0.0,
        "turnover_cny": _as_float(minute_row.get("amount_cny")),
        "volume_lot": _as_float(minute_row.get("volume_lot")),
        "open": open_price,
        "high": _as_float(minute_row.get("high"), close_price),
        "low": _as_float(minute_row.get("low"), close_price),
        "prev_close": prev_close,
        "source": "akshare.minute_bar_fallback",
    }


def fetch_minute_tail(code: str, tail_bars: int = 8) -> list[dict[str, Any]]:
    normalized = to_code(code)
    lookback_bars = max(int(tail_bars), MIN_RECOVERY_BARS)
    errors: list[str] = []

    try:
        df = ak.stock_zh_a_hist_min_em(symbol=normalized, period="1", adjust="")
        rows = df.tail(lookback_bars).to_dict(orient="records")
        normalized_rows = _normalize_minute_rows(normalized, rows)
        if normalized_rows:
            return normalized_rows
    except Exception as error:
        errors.append(f"hist_min_em: {error}")

    try:
        df = ak.stock_zh_a_minute(
            symbol=_to_prefixed_symbol(normalized), period="1", adjust=""
        )
        rows = df.tail(lookback_bars).to_dict(orient="records")
        normalized_rows = _normalize_minute_rows_from_minute_api(normalized, rows)
        if normalized_rows:
            return normalized_rows
    except Exception as error:
        errors.append(f"stock_zh_a_minute: {error}")

    if errors:
        raise RuntimeError("; ".join(errors))
    return []


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
    spot_quote_map: dict[str, dict[str, Any]] | None = None
    latest_minute_row_by_symbol: dict[str, dict[str, Any]] = {}

    with raw_minute_path.open("a", encoding="utf-8") as writer:
        for symbol in symbols:
            code = to_code(symbol)

            try:
                minute_rows = fetch_minute_tail(code, tail_bars=tail_bars)
                if minute_rows:
                    latest_minute_row_by_symbol[code] = minute_rows[-1]
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
                fallback_error: Exception | None = None
                if spot_quote_map is None:
                    try:
                        spot_quote_map = load_spot_quote_map()
                    except Exception as spot_error:
                        fallback_error = spot_error

                if spot_quote_map is not None:
                    try:
                        quote = fetch_quote_snapshot_from_spot_map(code, spot_quote_map)
                        quote["ingest_ts"] = datetime.now().isoformat(
                            timespec="seconds"
                        )
                        quote_rows.append(quote)
                        continue
                    except Exception as spot_error:
                        fallback_error = spot_error

                minute_row = latest_minute_row_by_symbol.get(code)
                if minute_row is not None:
                    quote = build_quote_snapshot_from_minute_row(code, minute_row)
                    quote["ingest_ts"] = datetime.now().isoformat(timespec="seconds")
                    quote_rows.append(quote)
                    continue

                errors.append(
                    {
                        "symbol_code": code,
                        "stage": "quote",
                        "error": f"primary={error}; fallback={fallback_error}",
                    }
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
