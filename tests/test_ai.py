import unittest
import logging

from ai.llm_player import LLMAIPlayer

logging.getLogger("ai.llm_player").setLevel(logging.CRITICAL)


class LLMAIPlayerParsingTests(unittest.TestCase):
    def setUp(self):
        self.ai = LLMAIPlayer(
            player_id="ai",
            name="AI",
            style="均衡",
            api_key="test-key",
            base_url="https://example.invalid/v1",
            model_name="test-model",
        )

    def test_parse_json_code_block_and_clamp_raise_amount(self):
        available = {
            "can_fold": True,
            "can_check": False,
            "can_call": True,
            "can_raise": True,
            "can_all_in": True,
            "to_call": 100,
            "min_raise_to": 300,
            "max_raise_to": 800,
        }
        content = (
            '```json\n'
            '{"action":"raise","amount":9999,"reasoning":"压迫对手"}\n'
            '```'
        )

        action = self.ai._parse_response(content, available)

        self.assertEqual(action, {
            "type": "raise",
            "amount": 800,
            "reasoning": "压迫对手",
        })

    def test_parse_invalid_json_action_returns_none_for_outer_fallback(self):
        available = {
            "can_fold": True,
            "can_check": True,
            "can_call": False,
            "can_raise": False,
            "can_all_in": True,
            "to_call": 0,
        }

        action = self.ai._parse_response(
            '{"action":"sing","amount":0,"reasoning":"bad"}',
            available,
        )

        self.assertIsNone(action)

    def test_regex_fallback_extracts_action_and_reasoning(self):
        available = {
            "can_fold": True,
            "can_check": False,
            "can_call": True,
            "can_raise": False,
            "can_all_in": True,
            "to_call": 100,
        }
        content = '我选择 call，因为赔率合适。{"reasoning":"赔率合适"}'

        action = self.ai._parse_response(content, available)

        self.assertEqual(action["type"], "call")
        self.assertEqual(action["amount"], 100)


if __name__ == "__main__":
    unittest.main()
