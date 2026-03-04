"""手牌评估器：从 7 张牌中选出最优 5 张，判定牌型和分数"""

from enum import IntEnum
from dataclasses import dataclass
from itertools import combinations
from typing import Dict, List, Optional, Tuple

from .card import Card, Rank, Suit


class HandRank(IntEnum):
    HIGH_CARD = 1       # 高牌
    ONE_PAIR = 2        # 一对
    TWO_PAIR = 3        # 两对
    THREE_OF_A_KIND = 4 # 三条
    STRAIGHT = 5        # 顺子
    FLUSH = 6           # 同花
    FULL_HOUSE = 7      # 葫芦
    FOUR_OF_A_KIND = 8  # 四条
    STRAIGHT_FLUSH = 9  # 同花顺
    ROYAL_FLUSH = 10    # 皇家同花顺

    def name_cn(self) -> str:
        return {
            HandRank.HIGH_CARD: "高牌",
            HandRank.ONE_PAIR: "一对",
            HandRank.TWO_PAIR: "两对",
            HandRank.THREE_OF_A_KIND: "三条",
            HandRank.STRAIGHT: "顺子",
            HandRank.FLUSH: "同花",
            HandRank.FULL_HOUSE: "葫芦",
            HandRank.FOUR_OF_A_KIND: "四条",
            HandRank.STRAIGHT_FLUSH: "同花顺",
            HandRank.ROYAL_FLUSH: "皇家同花顺",
        }[self]


@dataclass
class HandResult:
    rank: HandRank
    score: int          # 用于比较大小的数值分数
    best_five: List[Card]
    description: str = ""

    def __lt__(self, other: "HandResult") -> bool:
        return self.score < other.score

    def __le__(self, other: "HandResult") -> bool:
        return self.score <= other.score

    def __gt__(self, other: "HandResult") -> bool:
        return self.score > other.score

    def __ge__(self, other: "HandResult") -> bool:
        return self.score >= other.score

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, HandResult):
            return NotImplemented
        return self.score == other.score


class HandEvaluator:
    """从 5-7 张牌中评估最佳手牌"""

    # 牌型权重基数，确保高牌型总比低牌型大
    RANK_BASE = 10 ** 10

    @classmethod
    def evaluate(cls, cards: List[Card]) -> HandResult:
        if len(cards) < 5:
            raise ValueError(f"至少需要 5 张牌，当前 {len(cards)} 张")

        if len(cards) == 5:
            return cls._evaluate_five(cards)

        # 从 C(n,5) 种组合中选最优
        best: HandResult | None = None
        for combo in combinations(cards, 5):
            result = cls._evaluate_five(list(combo))
            if best is None or result > best:
                best = result
        return best

    @classmethod
    def _evaluate_five(cls, cards: List[Card]) -> HandResult:
        sorted_cards = sorted(cards, key=lambda c: c.rank, reverse=True)
        ranks = [c.rank.value for c in sorted_cards]
        suits = [c.suit for c in sorted_cards]

        is_flush = len(set(suits)) == 1
        is_straight, straight_high = cls._check_straight(ranks)

        # 统计点数出现次数
        rank_counts: Dict[int, int] = {}
        for r in ranks:
            rank_counts[r] = rank_counts.get(r, 0) + 1

        counts = sorted(rank_counts.values(), reverse=True)
        # 按(出现次数, 点数)降序排序的点数列表
        sorted_by_count = sorted(
            rank_counts.keys(),
            key=lambda r: (rank_counts[r], r),
            reverse=True,
        )

        # 判定牌型
        if is_flush and is_straight:
            if straight_high == Rank.ACE.value:
                hand_rank = HandRank.ROYAL_FLUSH
            else:
                hand_rank = HandRank.STRAIGHT_FLUSH
            score = cls._make_score(hand_rank, [straight_high])
            desc = hand_rank.name_cn()
        elif counts == [4, 1]:
            hand_rank = HandRank.FOUR_OF_A_KIND
            score = cls._make_score(hand_rank, sorted_by_count)
            desc = f"四条 {Rank(sorted_by_count[0]).symbol()}"
        elif counts == [3, 2]:
            hand_rank = HandRank.FULL_HOUSE
            score = cls._make_score(hand_rank, sorted_by_count)
            desc = f"葫芦 {Rank(sorted_by_count[0]).symbol()} over {Rank(sorted_by_count[1]).symbol()}"
        elif is_flush:
            hand_rank = HandRank.FLUSH
            score = cls._make_score(hand_rank, ranks)
            desc = "同花"
        elif is_straight:
            hand_rank = HandRank.STRAIGHT
            score = cls._make_score(hand_rank, [straight_high])
            desc = f"顺子 到 {Rank(straight_high).symbol()}"
        elif counts == [3, 1, 1]:
            hand_rank = HandRank.THREE_OF_A_KIND
            score = cls._make_score(hand_rank, sorted_by_count)
            desc = f"三条 {Rank(sorted_by_count[0]).symbol()}"
        elif counts == [2, 2, 1]:
            hand_rank = HandRank.TWO_PAIR
            score = cls._make_score(hand_rank, sorted_by_count)
            desc = f"两对 {Rank(sorted_by_count[0]).symbol()} 和 {Rank(sorted_by_count[1]).symbol()}"
        elif counts == [2, 1, 1, 1]:
            hand_rank = HandRank.ONE_PAIR
            score = cls._make_score(hand_rank, sorted_by_count)
            desc = f"一对 {Rank(sorted_by_count[0]).symbol()}"
        else:
            hand_rank = HandRank.HIGH_CARD
            score = cls._make_score(hand_rank, ranks)
            desc = f"高牌 {Rank(ranks[0]).symbol()}"

        # 对于顺子/同花顺，重排最佳五张
        if is_straight and straight_high == 5:
            # A-2-3-4-5 低顺，A 放最后
            best_five = sorted(
                sorted_cards,
                key=lambda c: c.rank.value if c.rank != Rank.ACE else 1,
                reverse=True,
            )
        else:
            best_five = sorted_cards

        return HandResult(
            rank=hand_rank,
            score=score,
            best_five=best_five,
            description=desc,
        )

    @classmethod
    def _check_straight(cls, ranks: List[int]) -> Tuple[bool, int]:
        unique = sorted(set(ranks), reverse=True)
        if len(unique) != 5:
            return False, 0

        # 正常顺子
        if unique[0] - unique[4] == 4:
            return True, unique[0]

        # A-2-3-4-5（轮转顺子）
        if unique == [14, 5, 4, 3, 2]:
            return True, 5

        return False, 0

    @classmethod
    def _make_score(cls, hand_rank: HandRank, kickers: List[int]) -> int:
        score = hand_rank.value * cls.RANK_BASE
        for i, k in enumerate(kickers):
            score += k * (15 ** (4 - i))
        return score
