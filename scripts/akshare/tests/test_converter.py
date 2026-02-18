import unittest

from scripts.akshare.converter import map_row_to_frame


class ConverterTest(unittest.TestCase):
    def test_map_row_to_frame(self):
        row = {
            "时间": "2026-02-12 14:58:00",
            "开盘": 10.98,
            "收盘": 10.96,
            "最高": 11.00,
            "最低": 10.95,
            "成交量": 5825,
            "成交额": 6384200.0,
        }
        frame = map_row_to_frame("000001", row, seq=1)

        self.assertEqual(frame["schema_version"], "market.bar.v1")
        self.assertEqual(frame["instrument"]["symbol"], "000001.SZ")
        self.assertEqual(frame["interval"], "1m")
        self.assertEqual(frame["bar"]["volume_shares"], 582500)
        self.assertEqual(frame["bar"]["turnover_cny"], 6384200.0)

    def test_map_row_to_frame_normalizes_quote_synthetic_ohlc(self):
        row = {
            "time": "2026-02-12 14:59:00",
            "open": 10.5,
            "close": 10.8,
            "high": 11.2,
            "low": 10.1,
            "volume_lot": 120,
            "amount_cny": 1296000.0,
            "source": "akshare.quote_synthetic_minute",
        }
        frame = map_row_to_frame("000001", row, seq=2)

        self.assertEqual(frame["bar"]["open"], 10.8)
        self.assertEqual(frame["bar"]["high"], 10.8)
        self.assertEqual(frame["bar"]["low"], 10.8)
        self.assertEqual(frame["bar"]["close"], 10.8)


if __name__ == "__main__":
    unittest.main()
