from __future__ import annotations

import argparse
import json
import os
from datetime import datetime
from datetime import time
from pathlib import Path
from typing import Any
import sys
import time as pytime
from zoneinfo import ZoneInfo

if __package__ is None or __package__ == "":
    sys.path.append(str(Path(__file__).resolve().parents[2]))

import akshare as ak
import requests

from scripts.akshare.common import (
    atomic_write_json,
    ensure_parent_dir,
    read_json_or_default,
    to_code,
)


DEFAULT_SYMBOLS = [
    "002131",
    "300058",
    "002342",
    "600519",
    "300059",
    "600089",
    "600986",
    "601899",
    "002050",
    "002195",
]
DEFAULT_RAW_MINUTE_PATH = Path("data/live/akshare/raw_minute.jsonl")
DEFAULT_RAW_QUOTES_PATH = Path("data/live/akshare/raw_quotes.json")
DEFAULT_CHECKPOINT_PATH = Path("data/live/akshare/checkpoint.json")
MIN_RECOVERY_BARS = 240
SH_TZ = ZoneInfo("Asia/Shanghai")
AKSHARE_HTTP_TIMEOUT_SEC = max(3.0, float(os.getenv("AKSHARE_HTTP_TIMEOUT_SEC", "8")))
AKSHARE_RETRY_ATTEMPTS = max(1, int(os.getenv("AKSHARE_RETRY_ATTEMPTS", "2")))
AKSHARE_RETRY_SLEEP_SEC = max(0.0, float(os.getenv("AKSHARE_RETRY_SLEEP_SEC", "0.2")))


def _install_requests_timeout_patch() -> None:
    if getattr(requests.sessions.Session.request, "_onlytrade_timeout_patched", False):
        return

    original_request = requests.sessions.Session.request

    def patched_request(self, method, url, **kwargs):
        timeout = kwargs.get("timeout")
        if timeout is None:
            kwargs["timeout"] = AKSHARE_HTTP_TIMEOUT_SEC
        return original_request(self, method, url, **kwargs)

    patched_request._onlytrade_timeout_patched = True  # type: ignore[attr-defined]
    requests.sessions.Session.request = patched_request


def _retry_call(fn, attempts: int = AKSHARE_RETRY_ATTEMPTS):
    last_error: Exception | None = None
    for attempt in range(max(1, attempts)):
        try:
            return fn()
        except Exception as error:
            last_error = error
            if attempt + 1 < attempts and AKSHARE_RETRY_SLEEP_SEC > 0:
                pytime.sleep(AKSHARE_RETRY_SLEEP_SEC)
    if last_error is not None:
        raise last_error
    raise RuntimeError("retry_call_failed_without_error")


_install_requests_timeout_patch()


def _is_cn_a_market_open(now: datetime | None = None) -> bool:
    current = now or datetime.now(SH_TZ)
    if current.tzinfo is None:
        current = current.replace(tzinfo=SH_TZ)
    else:
        current = current.astimezone(SH_TZ)

    if current.weekday() >= 5:
        return False

    current_time = current.time()
    morning_open = time(9, 30) <= current_time <= time(11, 30)
    afternoon_open = time(13, 0) <= current_time <= time(15, 0)
    return morning_open or afternoon_open


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
    df = _retry_call(lambda: ak.stock_zh_a_spot())
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


def _current_shanghai_minute_str() -> str:
    now = datetime.now(SH_TZ).replace(second=0, microsecond=0)
    return now.strftime("%Y-%m-%d %H:%M:%S")


def build_synthetic_minute_row_from_quote(
    code: str,
    quote: dict[str, Any],
    minute_time: str,
    volume_lot_delta: float = 0.0,
    amount_cny_delta: float = 0.0,
) -> dict[str, Any]:
    normalized = to_code(code)
    latest = _as_float(quote.get("latest"))
    # Quote APIs are usually day-level snapshots; for synthetic 1m bars we avoid
    # injecting day-open/high/low or cumulative turnover into a single minute.
    # Use flat OHLC at latest price and incremental volume/amount deltas only.
    open_price = latest
    high_price = latest
    low_price = latest
    volume_lot = max(0.0, _as_float(volume_lot_delta))
    amount_cny = max(0.0, _as_float(amount_cny_delta))
    avg_price = latest

    return {
        "symbol_code": normalized,
        "time": minute_time,
        "open": open_price,
        "close": latest,
        "high": high_price,
        "low": low_price,
        "volume_lot": volume_lot,
        "amount_cny": amount_cny,
        "avg_price": avg_price,
        "source": "akshare.quote_synthetic_minute",
    }


def fetch_minute_tail(code: str, tail_bars: int = 8) -> list[dict[str, Any]]:
    normalized = to_code(code)
    lookback_bars = max(int(tail_bars), MIN_RECOVERY_BARS)
    errors: list[str] = []

    try:
        df = _retry_call(
            lambda: ak.stock_zh_a_hist_min_em(symbol=normalized, period="1", adjust="")
        )
        rows = df.tail(lookback_bars).to_dict(orient="records")
        normalized_rows = _normalize_minute_rows(normalized, rows)
        if normalized_rows:
            return normalized_rows
    except Exception as error:
        errors.append(f"hist_min_em: {error}")

    try:
        df = _retry_call(
            lambda: ak.stock_zh_a_minute(
                symbol=_to_prefixed_symbol(normalized), period="1", adjust=""
            )
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
    df = _retry_call(lambda: ak.stock_bid_ask_em(symbol=normalized))
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
    last_quote_volume_lot_by_symbol = dict(
        checkpoint.get("last_quote_volume_lot_by_symbol") or {}
    )
    last_quote_turnover_cny_by_symbol = dict(
        checkpoint.get("last_quote_turnover_cny_by_symbol") or {}
    )

    ensure_parent_dir(raw_minute_path)
    appended = 0
    synthetic_appended = 0
    quote_rows: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    spot_quote_map: dict[str, dict[str, Any]] | None = None
    latest_minute_row_by_symbol: dict[str, dict[str, Any]] = {}

    with raw_minute_path.open("a", encoding="utf-8") as writer:
        for symbol in symbols:
            code = to_code(symbol)
            new_minute_written = False
            quote: dict[str, Any] | None = None

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
                    new_minute_written = True
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
                else:
                    errors.append(
                        {
                            "symbol_code": code,
                            "stage": "quote",
                            "error": f"primary={error}; fallback={fallback_error}",
                        }
                    )

            if quote is not None and not new_minute_written and _is_cn_a_market_open():
                minute_time = _current_shanghai_minute_str()
                last_seen = str(last_time_by_symbol.get(code) or "")
                if minute_time and (not last_seen or minute_time > last_seen):
                    prev_volume_lot = _as_float(
                        last_quote_volume_lot_by_symbol.get(code), -1
                    )
                    prev_turnover_cny = _as_float(
                        last_quote_turnover_cny_by_symbol.get(code), -1
                    )
                    curr_volume_lot = _as_float(quote.get("volume_lot"), 0)
                    curr_turnover_cny = _as_float(quote.get("turnover_cny"), 0)
                    volume_lot_delta = (
                        max(0.0, curr_volume_lot - prev_volume_lot)
                        if prev_volume_lot >= 0
                        else 0.0
                    )
                    amount_cny_delta = (
                        max(0.0, curr_turnover_cny - prev_turnover_cny)
                        if prev_turnover_cny >= 0
                        else 0.0
                    )

                    synthetic_row = build_synthetic_minute_row_from_quote(
                        code,
                        quote,
                        minute_time,
                        volume_lot_delta=volume_lot_delta,
                        amount_cny_delta=amount_cny_delta,
                    )
                    synthetic_row["ingest_ts"] = datetime.now().isoformat(
                        timespec="seconds"
                    )
                    writer.write(json.dumps(synthetic_row, ensure_ascii=False) + "\n")
                    appended += 1
                    synthetic_appended += 1
                    last_time_by_symbol[code] = minute_time

            if quote is not None:
                last_quote_volume_lot_by_symbol[code] = _as_float(
                    quote.get("volume_lot"), 0
                )
                last_quote_turnover_cny_by_symbol[code] = _as_float(
                    quote.get("turnover_cny"), 0
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
            "last_quote_volume_lot_by_symbol": last_quote_volume_lot_by_symbol,
            "last_quote_turnover_cny_by_symbol": last_quote_turnover_cny_by_symbol,
        },
    )

    return {
        "symbols_requested": len(symbols),
        "minute_rows_appended": appended,
        "synthetic_minute_rows_appended": synthetic_appended,
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
