"""玩家状态管理"""

from dataclasses import dataclass, field
from typing import List, Optional

from engine.card import Card


@dataclass
class Player:
    id: str
    name: str
    chips: int = 10000
    style: str = "均衡"
    model_id: str = ""

    # 每手牌状态（每手重置）
    hand: List[Card] = field(default_factory=list)
    folded: bool = False
    all_in: bool = False
    current_bet: int = 0   # 当前轮已下注金额
    total_bet: int = 0     # 本手总下注金额
    has_acted: bool = False
    is_eliminated: bool = False

    # 最近一次动作（用于展示）
    last_action: str = ""
    last_action_amount: int = 0

    def reset_for_new_hand(self):
        self.hand = []
        self.folded = False
        self.all_in = False
        self.current_bet = 0
        self.total_bet = 0
        self.has_acted = False
        self.last_action = ""
        self.last_action_amount = 0

    def reset_for_new_round(self):
        self.current_bet = 0
        self.has_acted = False

    def bet(self, amount: int) -> int:
        """下注，返回实际下注金额（可能因筹码不足而减少）"""
        actual = min(amount, self.chips)
        self.chips -= actual
        self.current_bet += actual
        self.total_bet += actual
        if self.chips == 0:
            self.all_in = True
        return actual

    def is_active(self) -> bool:
        """是否仍在本手牌中参与（未弃牌且未淘汰）"""
        return not self.folded and not self.is_eliminated

    def can_act(self) -> bool:
        """是否能行动（未弃牌、未全押、未淘汰）"""
        return not self.folded and not self.all_in and not self.is_eliminated

    def to_dict(self, hide_hand: bool = False) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "chips": self.chips,
            "style": self.style,
            "folded": self.folded,
            "all_in": self.all_in,
            "current_bet": self.current_bet,
            "total_bet": self.total_bet,
            "is_eliminated": self.is_eliminated,
            "last_action": self.last_action,
            "last_action_amount": self.last_action_amount,
            "hand": [] if hide_hand else [c.to_dict() for c in self.hand],
        }
