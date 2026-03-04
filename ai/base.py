"""AI 决策基础定义：动作类型、动作、游戏状态、抽象基类"""

from dataclasses import dataclass, field
from enum import Enum
from abc import ABC, abstractmethod
from typing import List, Optional


class ActionType(Enum):
    FOLD = "fold"
    CHECK = "check"
    CALL = "call"
    RAISE = "raise"
    ALL_IN = "all_in"


@dataclass
class Action:
    type: ActionType
    amount: int = 0
    reasoning: str = ""

    def to_dict(self) -> dict:
        return {
            "type": self.type.value,
            "amount": self.amount,
            "reasoning": self.reasoning,
        }


@dataclass
class GameState:
    hand: list
    community_cards: list
    pot: int
    current_bet: int
    my_chips: int
    my_bet: int
    players: list
    position: str
    stage: str
    min_raise: int
    big_blind: int
    available_actions: dict
    hand_number: int = 0


class AIPlayer(ABC):
    """AI 玩家抽象基类"""

    def __init__(self, player_id: str, name: str, style: str):
        self.player_id = player_id
        self.name = name
        self.style = style

    @abstractmethod
    async def decide(self, game_state: dict) -> dict:
        """
        根据游戏状态做出决策。

        Args:
            game_state: 完整的游戏状态字典

        Returns:
            {"type": "fold/check/call/raise/all_in", "amount": int, "reasoning": str}
        """
        ...

    def update_memory(self, hand_summary: str) -> None:
        """每手牌结束后更新记忆，由 GameController 回调"""
        pass

    def clear_memory(self) -> None:
        """游戏重置时清空记忆"""
        pass
