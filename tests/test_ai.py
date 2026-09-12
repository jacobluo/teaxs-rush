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

class DeepSeekEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def test_full_completion_url_is_not_appended_twice(self):
        try:
            import httpx2 as httpx  # OpenAI SDK 3.x
        except ImportError:
            import httpx
        import json
        from server.schemas import ModelCreate

        config = ModelCreate(name='DeepSeek', api_key='test-only')
        self.assertEqual(config.base_url, 'https://api.deepseek.com')
        self.assertEqual(config.model_name, 'deepseek-v4-pro')
        requests = []
        async def respond(request):
            requests.append(request)
            return httpx.Response(200, json={'id':'test','object':'chat.completion','created':0,
                'model':config.model_name,'choices':[{'index':0,'message':{'role':'assistant','content':'ok'},'finish_reason':'stop'}]})
        ai = LLMAIPlayer('ai', 'AI', '均衡', 'test-only',
                         'https://api.deepseek.com/chat/completions/', config.model_name)
        await ai.client._client.aclose()
        ai.client._client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        try:
            await ai.client.chat.completions.create(model=ai.model_name, messages=[{'role':'user','content':'test'}])
        finally:
            await ai.client.close()
        self.assertEqual(str(requests[0].url), 'https://api.deepseek.com/chat/completions')
        self.assertEqual(json.loads(requests[0].content)['model'], 'deepseek-v4-pro')

class DeepSeekDecisionTests(unittest.IsolatedAsyncioTestCase):
    async def test_short_deepseek_decisions_request_non_thinking_output(self):
        from types import SimpleNamespace
        from unittest.mock import AsyncMock
        ai = LLMAIPlayer('ai', 'AI', '均衡', 'test-only', 'https://api.deepseek.com', 'deepseek-v4-pro')
        ai.client.chat.completions.create = AsyncMock(return_value=SimpleNamespace(choices=[
            SimpleNamespace(message=SimpleNamespace(content='{"action":"check","reasoning":"test"}'))]))
        try:
            action = await ai.decide({'available_actions':{'can_check':True}})
            self.assertEqual(action['type'], 'check')
            self.assertEqual(ai.client.chat.completions.create.call_args.kwargs.get('extra_body'), {'thinking':{'type':'disabled'}})
        finally:
            await ai.client.close()
