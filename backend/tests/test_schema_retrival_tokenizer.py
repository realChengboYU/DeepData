# -*- coding: utf-8 -*-
"""Schema_Retrival 分词器单测。"""
import unittest

from app.Schema_Retrival import tokenize, tokenize_many


class TestTokenizer(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(tokenize(""), [])
        self.assertEqual(tokenize(None), [])

    def test_english_numbers_underscore(self):
        # 英文/数字/下划线连续词
        self.assertEqual(tokenize("total_trade_count"), ["total_trade_count"])
        self.assertEqual(tokenize("CREATORUSERID"), ["creatoruserid"])
        self.assertEqual(tokenize("id 1001"), ["id", "1001"])

    def test_chinese_span_plus_bigram(self):
        tokens = tokenize("销售额")
        self.assertIn("销售额", tokens)      # 整段
        self.assertIn("销售", tokens)        # bigram
        self.assertIn("售额", tokens)        # bigram
        self.assertIn("销", tokens)          # 单字
        self.assertIn("售", tokens)
        self.assertIn("额", tokens)

    def test_mixed(self):
        tokens = tokenize("本月 燃煤采购结算数量 count")
        self.assertIn("count", tokens)
        self.assertIn("燃煤采购结算数量", tokens)
        self.assertIn("燃煤", tokens)
        self.assertIn("本月", tokens)

    def test_lowercase(self):
        self.assertIn("abc", tokenize("AbC"))
        self.assertTrue(all(t == t.lower() for t in tokenize("AB_CD 中文")))

    def test_tokenize_many(self):
        out = tokenize_many(["销售额", "总交易笔数"])
        self.assertEqual(len(out), 2)
        self.assertIn("销售", out[0])
        self.assertIn("总交易笔数", out[1])


if __name__ == "__main__":
    unittest.main()
