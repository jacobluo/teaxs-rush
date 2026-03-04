"""下注轮管理：维护行动顺序、最低加注额、轮次结束判定"""

from typing import List, Optional
from game.player import Player


class BettingRound:
    """管理一个下注轮的完整流程"""

    def __init__(self, players: List[Player], starting_index: int, big_blind: int):
        """
        Args:
            players: 所有参与的玩家列表（按座位顺序）
            starting_index: 本轮第一个行动的玩家在列表中的索引
            big_blind: 大盲注金额
        """
        self.players = players
        self.big_blind = big_blind
        self.current_bet = 0       # 当前轮最高下注
        self.min_raise = big_blind  # 最低加注增量
        self.last_raiser_id: Optional[str] = None
        self.num_actions = 0

        # 构建行动队列（只包含能行动的玩家）
        n = len(players)
        self._action_order: List[int] = []
        for i in range(n):
            idx = (starting_index + i) % n
            if players[idx].can_act():
                self._action_order.append(idx)

        self._current_pos = 0

    def get_current_player(self) -> Optional[Player]:
        if self._current_pos >= len(self._action_order):
            return None
        return self.players[self._action_order[self._current_pos]]

    def get_available_actions(self, player: Player) -> dict:
        """获取当前玩家可执行的动作"""
        to_call = self.current_bet - player.current_bet
        min_raise_to = self.current_bet + self.min_raise

        actions = {
            "can_fold": True,
            "can_check": to_call == 0,
            "can_call": to_call > 0 and to_call < player.chips,
            "can_raise": player.chips > to_call,
            "can_all_in": player.chips > 0,
            "to_call": to_call,
            "min_raise_to": min_raise_to,
            "min_raise_amount": self.min_raise,
            "max_raise_to": player.current_bet + player.chips,
        }
        return actions

    def process_fold(self, player: Player):
        player.folded = True
        player.has_acted = True
        player.last_action = "FOLD"
        player.last_action_amount = 0
        self.num_actions += 1
        self._advance()

    def process_check(self, player: Player):
        player.has_acted = True
        player.last_action = "CHECK"
        player.last_action_amount = 0
        self.num_actions += 1
        self._advance()

    def process_call(self, player: Player) -> int:
        to_call = self.current_bet - player.current_bet
        actual = player.bet(to_call)
        player.has_acted = True
        player.last_action = "CALL"
        player.last_action_amount = actual
        self.num_actions += 1
        self._advance()
        return actual

    def process_raise(self, player: Player, raise_to: int) -> int:
        """
        Args:
            raise_to: 加注到的总金额（不是增量）
        """
        raise_increment = raise_to - self.current_bet
        if raise_increment > self.min_raise:
            self.min_raise = raise_increment

        to_bet = raise_to - player.current_bet
        actual = player.bet(to_bet)

        self.current_bet = player.current_bet
        self.last_raiser_id = player.id
        player.has_acted = True
        player.last_action = "RAISE"
        player.last_action_amount = self.current_bet
        self.num_actions += 1

        # 加注后其他玩家需要重新行动
        self._reset_action_order_after_raise(player)
        return actual

    def process_all_in(self, player: Player) -> int:
        all_in_amount = player.chips
        to_bet_total = player.current_bet + all_in_amount

        if to_bet_total > self.current_bet:
            raise_increment = to_bet_total - self.current_bet
            if raise_increment >= self.min_raise:
                self.min_raise = raise_increment
            self.current_bet = to_bet_total
            self.last_raiser_id = player.id
            player.last_action = "ALL IN (RAISE)"
            # 加注型 all-in，其他人需要重新行动
            actual = player.bet(all_in_amount)
            player.has_acted = True
            player.last_action_amount = self.current_bet
            self.num_actions += 1
            self._reset_action_order_after_raise(player)
        else:
            actual = player.bet(all_in_amount)
            player.has_acted = True
            player.last_action = "ALL IN (CALL)"
            player.last_action_amount = actual
            self.num_actions += 1
            self._advance()

        return actual

    def is_round_complete(self) -> bool:
        """判断本轮下注是否结束"""
        active_players = [p for p in self.players if p.can_act()]

        if len(active_players) == 0:
            return True

        if len(active_players) == 1:
            # 只剩一个能行动的玩家
            p = active_players[0]
            if p.has_acted or p.current_bet == self.current_bet:
                return True

        # 所有能行动的玩家都已行动且下注一致
        if all(p.has_acted for p in active_players):
            if all(p.current_bet == self.current_bet for p in active_players):
                return True

        return self._current_pos >= len(self._action_order)

    def _advance(self):
        self._current_pos += 1

    def _reset_action_order_after_raise(self, raiser: Player):
        """加注后重新构建行动队列，从加注者下一个位置开始"""
        raiser_idx = self.players.index(raiser)
        n = len(self.players)
        new_order: List[int] = []

        for i in range(1, n):
            idx = (raiser_idx + i) % n
            p = self.players[idx]
            if p.can_act() and p.id != raiser.id:
                new_order.append(idx)

        self._action_order = new_order
        self._current_pos = 0
