"""扑克牌基础模块：花色、点数、牌、牌组"""

from enum import IntEnum
from dataclasses import dataclass
import random
from typing import List


class Suit(IntEnum):
    SPADES = 4    # ♠
    HEARTS = 3    # ♥
    DIAMONDS = 2  # ♦
    CLUBS = 1     # ♣

    def symbol(self) -> str:
        return {
            Suit.SPADES: "♠",
            Suit.HEARTS: "♥",
            Suit.DIAMONDS: "♦",
            Suit.CLUBS: "♣",
        }[self]

    def name_cn(self) -> str:
        return {
            Suit.SPADES: "黑桃",
            Suit.HEARTS: "红心",
            Suit.DIAMONDS: "方块",
            Suit.CLUBS: "梅花",
        }[self]


class Rank(IntEnum):
    TWO = 2
    THREE = 3
    FOUR = 4
    FIVE = 5
    SIX = 6
    SEVEN = 7
    EIGHT = 8
    NINE = 9
    TEN = 10
    JACK = 11
    QUEEN = 12
    KING = 13
    ACE = 14

    def symbol(self) -> str:
        if self.value <= 10:
            return str(self.value)
        return {
            Rank.JACK: "J",
            Rank.QUEEN: "Q",
            Rank.KING: "K",
            Rank.ACE: "A",
        }[self]


@dataclass(frozen=True)
class Card:
    suit: Suit
    rank: Rank

    def __str__(self) -> str:
        return f"{self.rank.symbol()}{self.suit.symbol()}"

    def __repr__(self) -> str:
        return f"Card({self.rank.symbol()}{self.suit.symbol()})"

    def __lt__(self, other: "Card") -> bool:
        if self.rank != other.rank:
            return self.rank < other.rank
        return self.suit < other.suit

    def __le__(self, other: "Card") -> bool:
        return self == other or self < other

    def __gt__(self, other: "Card") -> bool:
        return not self <= other

    def __ge__(self, other: "Card") -> bool:
        return not self < other

    def to_dict(self) -> dict:
        return {
            "suit": self.suit.symbol(),
            "rank": self.rank.symbol(),
            "suit_name": self.suit.name_cn(),
            "value": self.rank.value,
        }


class Deck:
    """标准 52 张扑克牌组"""

    def __init__(self):
        self._cards: List[Card] = []
        self.reset()

    def reset(self):
        self._cards = [
            Card(suit=s, rank=r) for s in Suit for r in Rank
        ]
        self.shuffle()

    def shuffle(self):
        random.shuffle(self._cards)

    def deal(self, count: int = 1) -> List[Card]:
        if count > len(self._cards):
            raise ValueError(f"牌组剩余 {len(self._cards)} 张，无法发 {count} 张")
        dealt = self._cards[:count]
        self._cards = self._cards[count:]
        return dealt

    def deal_one(self) -> Card:
        return self.deal(1)[0]

    @property
    def remaining(self) -> int:
        return len(self._cards)
