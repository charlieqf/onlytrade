import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from scripts.akshare.run_cycle_if_market_open import is_cn_a_market_open


class MarketSessionGuardTest(unittest.TestCase):
    def test_cn_a_session_boundaries(self):
        tz = ZoneInfo("Asia/Shanghai")
        self.assertFalse(is_cn_a_market_open(datetime(2026, 2, 13, 9, 29, tzinfo=tz)))
        self.assertTrue(is_cn_a_market_open(datetime(2026, 2, 13, 9, 30, tzinfo=tz)))
        self.assertTrue(is_cn_a_market_open(datetime(2026, 2, 13, 11, 30, tzinfo=tz)))
        self.assertFalse(is_cn_a_market_open(datetime(2026, 2, 13, 11, 31, tzinfo=tz)))
        self.assertFalse(is_cn_a_market_open(datetime(2026, 2, 13, 12, 59, tzinfo=tz)))
        self.assertTrue(is_cn_a_market_open(datetime(2026, 2, 13, 13, 0, tzinfo=tz)))
        self.assertTrue(is_cn_a_market_open(datetime(2026, 2, 13, 15, 0, tzinfo=tz)))
        self.assertFalse(is_cn_a_market_open(datetime(2026, 2, 13, 15, 1, tzinfo=tz)))

    def test_weekend_is_closed(self):
        tz = ZoneInfo("Asia/Shanghai")
        self.assertFalse(is_cn_a_market_open(datetime(2026, 2, 14, 10, 0, tzinfo=tz)))


if __name__ == "__main__":
    unittest.main()
