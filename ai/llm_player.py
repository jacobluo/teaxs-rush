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
                logger.info(f"[{self.name}] LLM 原始响应: {content[:500]}")
                action = self._parse_response(content, available)
                if action:
                    return action
                else:
                    logger.warning(f"[{self.name}] 解析返回 None, 完整内容: {content}")

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

        def extract_json_objects(text):
            """从文本中提取所有可能的 JSON 对象，支持字符串内的花括号"""
            results = []
            i = 0
            while i < len(text):
                if text[i] == '{':
                    # 尝试从这个位置提取 JSON
                    depth = 0
                    in_string = False
                    escape = False
                    for j in range(i, len(text)):
                        ch = text[j]
                        if escape:
                            escape = False
                            continue
                        if ch == '\\' and in_string:
                            escape = True
                            continue
                        if ch == '"' and not escape:
                            in_string = not in_string
                            continue
                        if not in_string:
                            if ch == '{':
                                depth += 1
                            elif ch == '}':
                                depth -= 1
                                if depth == 0:
                                    candidate = text[i:j + 1]
                                    try:
                                        obj = json.loads(candidate)
                                        results.append(obj)
                                    except json.JSONDecodeError:
                                        pass
                                    i = j + 1
                                    break
                    else:
                        i += 1
                else:
                    i += 1
            return results

        # 预处理：去除 markdown 代码块标记
        cleaned = content
        cleaned = re.sub(r'```(?:json)?\s*', '', cleaned)
        cleaned = re.sub(r'```', '', cleaned)

        # 方法1：先尝试直接 json.loads 整段内容
        try:
            data = json.loads(cleaned)
            if isinstance(data, dict):
                action_type = str(data.get("action", "")).lower().strip()
                if action_type in ("fold", "check", "call", "raise", "all_in"):
                    amount = int(data.get("amount", 0))
                    reasoning = data.get("reasoning", "")
                    validated = self._validate_action(action_type, amount, available)
                    validated["reasoning"] = reasoning
                    logger.info(f"[解析成功-直接JSON] action={action_type}")
                    return validated
        except (json.JSONDecodeError, ValueError, TypeError):
            pass

        # 方法2：括号匹配提取 JSON
        try:
            json_objects = extract_json_objects(cleaned)
            logger.info(f"[解析] 提取到 {len(json_objects)} 个 JSON 对象")
            for idx, data in enumerate(json_objects):
                if not isinstance(data, dict):
                    logger.info(f"[解析] JSON #{idx} 不是 dict: {type(data)}")
                    continue
                action_type = str(data.get("action", "")).lower().strip()
                logger.info(f"[解析] JSON #{idx} action='{action_type}', keys={list(data.keys())}")
                if action_type in ("fold", "check", "call", "raise", "all_in"):
                    amount = int(data.get("amount", 0))
                    reasoning = data.get("reasoning", "")
                    validated = self._validate_action(
                        action_type, amount, available
                    )
                    validated["reasoning"] = reasoning
                    logger.info(f"[解析成功-括号匹配] action={action_type}")
                    return validated
                else:
                    logger.warning(f"[解析] action '{action_type}' 不在合法列表中")
        except (ValueError, TypeError) as e:
            logger.warning(f"JSON 解析异常: {e}")

        # 方法3：宽松正则提取 JSON 字段
        try:
            action_re = re.search(r'"action"\s*:\s*"(\w+)"', cleaned, re.IGNORECASE)
            amount_re = re.search(r'"amount"\s*:\s*(\d+)', cleaned)
            reasoning_re = re.search(r'"reasoning"\s*:\s*"((?:[^"\\]|\\.)*)"', cleaned, re.DOTALL)
            if action_re:
                action_type = action_re.group(1).lower().strip()
                if action_type in ("fold", "check", "call", "raise", "all_in"):
                    amount = int(amount_re.group(1)) if amount_re else 0
                    reasoning = reasoning_re.group(1) if reasoning_re else ""
                    validated = self._validate_action(action_type, amount, available)
                    validated["reasoning"] = reasoning
                    logger.info(f"[解析成功-正则字段] action={action_type}")
                    return validated
        except (ValueError, TypeError) as e:
            logger.warning(f"正则字段提取异常: {e}")

        # 方法4：最后的 fallback
        logger.warning(f"[解析走fallback] 原始内容: {content[:300]}")
        action_match = re.search(
            r'(fold|check|call|raise|all_in)', content.lower()
        )
        if action_match:
            action_type = action_match.group(1)
            amount = 0
            amount_match = re.search(r'(\d+)', content)
            if amount_match and action_type == "raise":
                amount = int(amount_match.group(1))

            # 尝试从文本中提取推理内容
            reasoning = ""
            reason_match = re.search(
                r'(?:reasoning|理由|原因|分析)["\s:：]*["\s]*(.+?)(?:["\s]*[,}]|$)',
                content, re.DOTALL
            )
            if reason_match:
                reasoning = reason_match.group(1).strip().strip('"').strip()
            if not reasoning:
                reasoning = "（LLM 响应解析 fallback）"

            validated = self._validate_action(action_type, amount, available)
            validated["reasoning"] = reasoning
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
