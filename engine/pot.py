"""底池管理器：处理主池、边池分配"""

from dataclasses import dataclass, field
from typing import Dict, List, Set, Tuple


@dataclass
class SidePot:
    amount: int
    eligible_players: Set[str]  # player_id 集合


class PotManager:
    """管理下注和底池分配，支持多个 all-in 边池"""

    def __init__(self):
        self._bets: Dict[str, int] = {}  # player_id -> 本手总下注
        self._folded: Set[str] = set()

    def reset(self):
        self._bets.clear()
        self._folded.clear()

    def add_bet(self, player_id: str, amount: int):
        self._bets[player_id] = self._bets.get(player_id, 0) + amount

    def mark_folded(self, player_id: str):
        self._folded.add(player_id)

    def get_total_pot(self) -> int:
        return sum(self._bets.values())

    def get_player_bet(self, player_id: str) -> int:
        return self._bets.get(player_id, 0)

    def calculate_side_pots(self) -> List[SidePot]:
        """按 all-in 金额从小到大切割主池和边池"""
        if not self._bets:
            return []

        # 获取所有不同的下注金额（从小到大）
        all_bet_amounts = sorted(set(self._bets.values()))
        pots: List[SidePot] = []
        prev_level = 0

        for level in all_bet_amounts:
            increment = level - prev_level
            if increment <= 0:
                continue

            pot_amount = 0
            eligible = set()

            for pid, bet in self._bets.items():
                if bet >= level:
                    pot_amount += increment
                    # 没弃牌的玩家才有资格赢池
                    if pid not in self._folded:
                        eligible.add(pid)
                elif bet > prev_level:
                    pot_amount += bet - prev_level

            if pot_amount > 0:
                pots.append(SidePot(amount=pot_amount, eligible_players=eligible))

            prev_level = level

        return pots

    def distribute(
        self,
        player_scores: Dict[str, int],
    ) -> Dict[str, int]:
        """
        根据手牌评分分配底池。

        Args:
            player_scores: {player_id: score}，score 越高牌越大

        Returns:
            {player_id: 赢得金额}
        """
        winnings: Dict[str, int] = {}
        side_pots = self.calculate_side_pots()

        for pot in side_pots:
            eligible = pot.eligible_players
            if not eligible:
                # 所有有资格的玩家都弃牌了，底池分给还在的玩家
                remaining = {
                    pid for pid in self._bets if pid not in self._folded
                }
                if remaining:
                    eligible = remaining

            if not eligible:
                continue

            # 找出有资格且分数最高的玩家
            eligible_with_scores = {
                pid: player_scores.get(pid, 0)
                for pid in eligible
                if pid in player_scores
            }

            if not eligible_with_scores:
                continue

            max_score = max(eligible_with_scores.values())
            winners = [
                pid
                for pid, s in eligible_with_scores.items()
                if s == max_score
            ]

            # 平分底池
            share = pot.amount // len(winners)
            remainder = pot.amount % len(winners)

            for i, winner in enumerate(winners):
                won = share + (1 if i < remainder else 0)
                winnings[winner] = winnings.get(winner, 0) + won

        return winnings
