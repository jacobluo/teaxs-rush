"""LLM AI 玩家：通过大模型 API 进行决策，支持对话上下文记忆"""

import json
import re
import asyncio
import logging
from typing import Optional, List, Dict
from collections import deque

from openai import AsyncOpenAI

from ai.base import AIPlayer
from ai.styles import STYLES
from ai.prompt_builder import PromptBuilder

logger = logging.getLogger(__name__)

MAX_MEMORY_SIZE = 10  # 最多保留最近 10 手牌的记忆


class LLMAIPlayer(AIPlayer):
    """基于 LLM 的 AI 玩家，支持上下文记忆"""

    def __init__(
        self,
        player_id: str,
        name: str,
        style: str,
        api_key: str,
        base_url: str,
        model_name: str,
    ):
        super().__init__(player_id, name, style)
        self.api_key = api_key
        self.base_url = base_url
        self.model_name = model_name

        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
        )

        # 对话上下文记忆
        self._memory: deque[str] = deque(maxlen=MAX_MEMORY_SIZE)

        # 获取风格 prompt
        style_config = STYLES.get(style, STYLES["均衡"])
        self.system_prompt = style_config["system_prompt"]

    async def decide(self, game_state: dict) -> dict:
        """通过 LLM API 做出决策"""
        user_prompt = PromptBuilder.build(game_state)
        available = game_state.get("available_actions", {})

        # 构建 messages：system + memory + user
        messages = [{"role": "system", "content": self.system_prompt}]

        # 注入记忆上下文
        if self._memory:
            memory_text = "\n".join(self._memory)
            messages.append({
                "role": "assistant",
                "content": f"【历史记忆】以下是我最近几手牌的经历回顾：\n{memory_text}",
            })

        messages.append({"role": "user", "content": user_prompt})

        # 尝试调用 LLM，含重试
        for attempt in range(3):
            try:
                response = await asyncio.wait_for(
                    self.client.chat.completions.create(
                        model=self.model_name,
                        messages=messages,
                        temperature=0.7,
                        max_tokens=500,
                    ),
                    timeout=30,
                )

                content = response.choices[0].message.content.strip()
                action = self._parse_response(content, available)
                if action:
                    return action

            except asyncio.TimeoutError:
                logger.warning(
                    f"[{self.name}] LLM 调用超时 (尝试 {attempt + 1}/3)"
                )
            except Exception as e:
                logger.warning(
                    f"[{self.name}] LLM 调用异常: {e} (尝试 {attempt + 1}/3)"
                )

            if attempt < 2:
                await asyncio.sleep(1)

        # 所有尝试失败，使用 fallback
        return self._fallback_action(available)

    def _parse_response(self, content: str, available: dict) -> Optional[dict]:
        """解析 LLM 响应，提取动作"""
        # 尝试直接 JSON 解析
        try:
            # 提取 JSON 块
            json_match = re.search(r'\{[^}]+\}', content, re.DOTALL)
            if json_match:
                data = json.loads(json_match.group())
                action_type = data.get("action", "").lower().strip()
                amount = int(data.get("amount", 0))
                reasoning = data.get("reasoning", "")

                if action_type in ("fold", "check", "call", "raise", "all_in"):
                    # 验证动作合法性
                    validated = self._validate_action(
                        action_type, amount, available
                    )
                    validated["reasoning"] = reasoning
                    return validated
        except (json.JSONDecodeError, ValueError, TypeError):
            pass

        # 正则 fallback
        action_match = re.search(
            r'(fold|check|call|raise|all_in)', content.lower()
        )
        if action_match:
            action_type = action_match.group(1)
            amount = 0
            amount_match = re.search(r'(\d+)', content)
            if amount_match and action_type == "raise":
                amount = int(amount_match.group(1))

            validated = self._validate_action(action_type, amount, available)
            validated["reasoning"] = "（LLM 响应解析 fallback）"
            return validated

        return None

    def _validate_action(self, action_type: str, amount: int, available: dict) -> dict:
        """验证并修正动作合法性"""
        if action_type == "check" and available.get("can_check"):
            return {"type": "check", "amount": 0}
        elif action_type == "call" and available.get("can_call"):
            return {"type": "call", "amount": available.get("to_call", 0)}
        elif action_type == "raise" and available.get("can_raise"):
            min_raise_to = available.get("min_raise_to", 0)
            max_raise_to = available.get("max_raise_to", 0)
            if amount < min_raise_to:
                amount = min_raise_to
            elif amount > max_raise_to:
                amount = max_raise_to
            return {"type": "raise", "amount": amount}
        elif action_type == "all_in" and available.get("can_all_in"):
            return {"type": "all_in", "amount": 0}
        elif action_type == "fold":
            return {"type": "fold", "amount": 0}

        # 动作不可用，自动修正
        if available.get("can_check"):
            return {"type": "check", "amount": 0}
        if available.get("can_call"):
            return {"type": "call", "amount": available.get("to_call", 0)}
        return {"type": "fold", "amount": 0}

    def _fallback_action(self, available: dict) -> dict:
        """所有 LLM 调用失败时的兜底策略"""
        if available.get("can_check"):
            return {
                "type": "check",
                "amount": 0,
                "reasoning": "（LLM 调用失败，自动过牌）",
            }
        return {
            "type": "fold",
            "amount": 0,
            "reasoning": "（LLM 调用失败，自动弃牌）",
        }

    def update_memory(self, hand_summary: str) -> None:
        """追加一手牌的记忆摘要"""
        self._memory.append(hand_summary)

    def clear_memory(self) -> None:
        """清空全部记忆"""
        self._memory.clear()
