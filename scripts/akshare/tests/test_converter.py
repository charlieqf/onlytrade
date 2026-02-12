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


if __name__ == "__main__":
    unittest.main()
