# -*- coding: utf-8 -*-
"""prompt 注入 Schema 上下文的单测。"""
import unittest

from app.prompt.builder import build_messages, compose_system_prompt
from app.prompt.system import SYSTEM_PROMPT


class TestComposeSystemPrompt(unittest.TestCase):
    def test_no_extras_returns_system(self):
        self.assertEqual(compose_system_prompt(), SYSTEM_PROMPT)

    def test_schema_context_appended(self):
        prompt = compose_system_prompt(schema_context="SCHEMA_BLOCK")
        self.assertIn("## 相关数据表 Schema", prompt)
        self.assertIn("SCHEMA_BLOCK", prompt)
        self.assertTrue(prompt.startswith(SYSTEM_PROMPT[:30]))

    def test_skill_and_schema_both(self):
        prompt = compose_system_prompt(
            skill_instructions="SKILL_BLOCK", schema_context="SCHEMA_BLOCK"
        )
        self.assertIn("SKILL_BLOCK", prompt)
        self.assertIn("SCHEMA_BLOCK", prompt)
        # 顺序：system -> skill -> schema
        self.assertLess(prompt.index("SKILL_BLOCK"), prompt.index("SCHEMA_BLOCK"))


class TestBuildMessages(unittest.TestCase):
    def test_full_messages(self):
        msgs = build_messages(
            history=[{"role": "user", "content": "hi"}],
            question="现在呢",
            skill_instructions="SKILL",
            schema_context="SCHEMA",
        )
        self.assertEqual(msgs[0]["role"], "system")
        self.assertIn("SCHEMA", msgs[0]["content"])
        self.assertEqual(msgs[1], {"role": "user", "content": "hi"})
        self.assertEqual(msgs[-1], {"role": "user", "content": "现在呢"})

    def test_no_schema_context_no_section(self):
        msgs = build_messages(history=[], question="q")
        self.assertNotIn("相关数据表 Schema", msgs[0]["content"])


if __name__ == "__main__":
    unittest.main()
