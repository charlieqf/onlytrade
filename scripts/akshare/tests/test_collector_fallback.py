import json
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import pandas as pd

import scripts.akshare.collector as collector


class CollectorFallbackTest(unittest.TestCase):
    def _hist_minute_df(self, bars: int) -> pd.DataFrame:
        start = datetime(2026, 2, 13, 9, 30)
        rows = []
        for i in range(bars):
            current = start + timedelta(minutes=i)
            rows.append(
                {
                    "时间": current.strftime("%Y-%m-%d %H:%M:%S"),
                    "开盘": 100 + i,
                    "收盘": 100 + i + 0.2,
                    "最高": 100 + i + 0.5,
                    "最低": 100 + i - 0.5,
                    "成交量": 1000 + i,
                    "成交额": 100000 + i,
                    "均价": 100 + i + 0.1,
                }
            )
        return pd.DataFrame(rows)

    def test_fetch_minute_falls_back_to_stock_zh_a_minute(self):
        fallback_df = pd.DataFrame(
            [
                {
                    "day": "2026-02-13 09:30:00",
                    "open": "10.0",
                    "high": "10.2",
                    "low": "9.9",
                    "close": "10.1",
                    "volume": "1200",
                },
                {
                    "day": "2026-02-13 09:31:00",
                    "open": "10.1",
                    "high": "10.3",
                    "low": "10.0",
                    "close": "10.2",
                    "volume": "1300",
                },
            ]
        )

        with (
            patch.object(
                collector.ak,
                "stock_zh_a_hist_min_em",
                side_effect=RuntimeError("blocked"),
            ),
            patch.object(collector.ak, "stock_zh_a_minute", return_value=fallback_df),
        ):
            rows = collector.fetch_minute_tail("600519", tail_bars=1)

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[-1]["symbol_code"], "600519")
        self.assertEqual(rows[-1]["source"], "akshare.stock_zh_a_minute")
        self.assertEqual(rows[-1]["time"], "2026-02-13 09:31:00")

    def test_fetch_minute_uses_recovery_window_for_backfill(self):
        with patch.object(
            collector.ak,
            "stock_zh_a_hist_min_em",
            return_value=self._hist_minute_df(300),
        ):
            rows = collector.fetch_minute_tail("600519", tail_bars=8)

        self.assertGreaterEqual(len(rows), 240)
        self.assertEqual(rows[-1]["time"], "2026-02-13 14:29:00")

    def test_run_collection_falls_back_to_stock_zh_a_spot_for_quotes(self):
        spot_df = pd.DataFrame(
            [
                {
                    "代码": "sh600519",
                    "最新价": 1490.1,
                    "涨跌幅": 0.52,
                    "成交额": 2000000,
                    "成交量": 15000,
                    "今开": 1488.0,
                    "最高": 1491.0,
                    "最低": 1486.5,
                    "昨收": 1482.4,
                }
            ]
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            raw_minute_path = temp_root / "raw_minute.jsonl"
            raw_quotes_path = temp_root / "raw_quotes.json"
            checkpoint_path = temp_root / "checkpoint.json"

            with (
                patch("scripts.akshare.collector.fetch_minute_tail", return_value=[]),
                patch.object(
                    collector.ak,
                    "stock_bid_ask_em",
                    side_effect=RuntimeError("blocked"),
                ),
                patch.object(collector.ak, "stock_zh_a_spot", return_value=spot_df),
            ):
                summary = collector.run_collection(
                    symbols=["600519"],
                    raw_minute_path=raw_minute_path,
                    raw_quotes_path=raw_quotes_path,
                    checkpoint_path=checkpoint_path,
                    tail_bars=8,
                )

            self.assertEqual(summary["quotes_collected"], 1)
            self.assertEqual(summary["errors"], [])

            payload = json.loads(raw_quotes_path.read_text(encoding="utf-8"))
            self.assertEqual(len(payload["rows"]), 1)
            self.assertEqual(payload["rows"][0]["source"], "akshare.stock_zh_a_spot")

    def test_run_collection_uses_minute_bar_quote_if_other_sources_fail(self):
        minute_rows = [
            {
                "symbol_code": "600519",
                "time": "2026-02-13 09:31:00",
                "open": 1488.0,
                "close": 1490.1,
                "high": 1491.0,
                "low": 1486.5,
                "volume_lot": 15000,
                "amount_cny": 2000000,
                "avg_price": 1489.2,
                "source": "akshare.stock_zh_a_minute",
            }
        ]

        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            raw_minute_path = temp_root / "raw_minute.jsonl"
            raw_quotes_path = temp_root / "raw_quotes.json"
            checkpoint_path = temp_root / "checkpoint.json"

            with (
                patch(
                    "scripts.akshare.collector.fetch_minute_tail",
                    return_value=minute_rows,
                ),
                patch.object(
                    collector.ak,
                    "stock_bid_ask_em",
                    side_effect=RuntimeError("blocked"),
                ),
                patch.object(
                    collector.ak, "stock_zh_a_spot", side_effect=RuntimeError("blocked")
                ),
            ):
                summary = collector.run_collection(
                    symbols=["600519"],
                    raw_minute_path=raw_minute_path,
                    raw_quotes_path=raw_quotes_path,
                    checkpoint_path=checkpoint_path,
                    tail_bars=8,
                )

            self.assertEqual(summary["quotes_collected"], 1)
            self.assertEqual(summary["errors"], [])

            payload = json.loads(raw_quotes_path.read_text(encoding="utf-8"))
            self.assertEqual(
                payload["rows"][0]["source"], "akshare.minute_bar_fallback"
            )


if __name__ == "__main__":
    unittest.main()
