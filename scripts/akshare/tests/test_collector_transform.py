import unittest

from scripts.akshare.common import to_code, to_onlytrade_symbol


class SymbolMapTest(unittest.TestCase):
    def test_symbol_mapping(self):
        self.assertEqual(to_onlytrade_symbol("600519"), "600519.SH")
        self.assertEqual(to_onlytrade_symbol("300750"), "300750.SZ")
        self.assertEqual(to_onlytrade_symbol("sh600519"), "600519.SH")
        self.assertEqual(to_onlytrade_symbol("sz000001"), "000001.SZ")

    def test_to_code(self):
        self.assertEqual(to_code("600519"), "600519")
        self.assertEqual(to_code("sh600519"), "600519")
        self.assertEqual(to_code("1"), "000001")


if __name__ == "__main__":
    unittest.main()
