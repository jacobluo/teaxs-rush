"""游戏控制器：状态机驱动一手牌生命周期，多手连续对战"""

import asyncio
from enum import Enum
from typing import Any, Dict, List, Optional, Callable

from engine import Card, Deck, HandEvaluator, PotManager
from game.player import Player
from game.betting import BettingRound


class GameStage(str, Enum):
    WAITING = "waiting"
    PREFLOP = "preflop"
    FLOP = "flop"
    TURN = "turn"
    RIVER = "river"
    SHOWDOWN = "showdown"
    HAND_COMPLETE = "hand_complete"
    GAME_OVER = "game_over"


class GameController:
    """状态机驱动的德州扑克游戏控制器"""

    def __init__(
        self,
        players: List[Player],
        big_blind: int = 100,
        starting_chips: int = 10000,
        max_hands: int = 10,
        action_delay: float = 2.0,
        eliminate_on_zero: bool = True,
        blind_increase_interval: int = 0,
        on_event: Optional[Callable] = None,
    ):
        self.players = players
        self.big_blind = big_blind
        self.small_blind = big_blind // 2
        self.initial_big_blind = big_blind
        self.starting_chips = starting_chips
        self.max_hands = max_hands
        self.action_delay = action_delay
        self.eliminate_on_zero = eliminate_on_zero
        self.blind_increase_interval = blind_increase_interval
        self.on_event = on_event

        self.dealer_index = 0
        self.hand_number = 0
        self.stage = GameStage.WAITING
        self.deck = Deck()
        self.pot_manager = PotManager()
        self.community_cards: List[Card] = []
        self.current_betting: Optional[BettingRound] = None

        # 盲注位置
        self._sb_index: int = 0
        self._bb_index: int = 0

        # 控制状态
        self._thinking_player_id: Optional[str] = None
        self.is_paused = False
        self.is_running = False
        self.step_mode = False
        self._step_event = asyncio.Event()
        self._pause_event = asyncio.Event()
        self._pause_event.set()

        # AI 决策回调
        self._ai_decide: Optional[Callable] = None

        # 手牌结束回调（用于更新 AI 记忆）
        self._on_hand_complete: Optional[Callable] = None

    def set_ai_callback(self, callback: Callable):
        self._ai_decide = callback

    def set_hand_complete_callback(self, callback: Callable):
        self._on_hand_complete = callback

    async def emit_event(self, event_type: str, data: dict = None):
        if self.on_event:
            await self.on_event(event_type, data or {})

    def get_active_players(self) -> List[Player]:
        return [p for p in self.players if not p.is_eliminated]

    def get_in_hand_players(self) -> List[Player]:
        return [p for p in self.get_active_players() if p.is_active()]

    async def run_game(self):
        """运行完整游戏循环"""
        self.is_running = True
        await self.emit_event("game_start", {
            "players": [p.to_dict() for p in self.players],
            "big_blind": self.big_blind,
            "max_hands": self.max_hands,
        })

        while self.is_running:
            # 检查暂停
            await self._pause_event.wait()

            # 检查游戏结束条件
            active = self.get_active_players()
            if len(active) <= 1:
                break
            if self.max_hands > 0 and self.hand_number >= self.max_hands:
                break

            # 盲注递增
            if (
                self.blind_increase_interval > 0
                and self.hand_number > 0
                and self.hand_number % self.blind_increase_interval == 0
            ):
                self.big_blind *= 2
                self.small_blind = self.big_blind // 2
                await self.emit_event("blind_increase", {
                    "big_blind": self.big_blind,
                    "small_blind": self.small_blind,
                })

            await self._play_one_hand()

            # 单步模式
            if self.step_mode:
                self._step_event.clear()
                await self._step_event.wait()

        self.stage = GameStage.GAME_OVER
        self.is_running = False
        await self.emit_event("game_over", {
            "players": [p.to_dict() for p in self.players],
            "hand_number": self.hand_number,
        })

    async def _play_one_hand(self):
        """执行一手牌的完整流程"""
        self.hand_number += 1
        active = self.get_active_players()

        # 重置状态
        self.deck.reset()
        self.pot_manager.reset()
        self.community_cards = []
        for p in active:
            p.reset_for_new_hand()

        # 确定位置
        self.dealer_index = self.dealer_index % len(active)
        n = len(active)
        sb_index = (self.dealer_index + 1) % n
        bb_index = (self.dealer_index + 2) % n
        # 两人时庄位是小盲
        if n == 2:
            sb_index = self.dealer_index
            bb_index = (self.dealer_index + 1) % n

        # 同步到实例属性，供 get_state() 使用
        self._sb_index = sb_index
        self._bb_index = bb_index

        await self.emit_event("hand_start", {
            "hand_number": self.hand_number,
            "dealer": active[self.dealer_index].to_dict(),
            "small_blind_player": active[sb_index].to_dict(),
            "big_blind_player": active[bb_index].to_dict(),
            "big_blind": self.big_blind,
            "small_blind": self.small_blind,
        })

        # 发小盲和大盲
        sb_amount = active[sb_index].bet(self.small_blind)
        self.pot_manager.add_bet(active[sb_index].id, sb_amount)
        await self.emit_event("blind_post", {
            "player": active[sb_index].to_dict(),
            "amount": sb_amount,
            "type": "small_blind",
        })

        bb_amount = active[bb_index].bet(self.big_blind)
        self.pot_manager.add_bet(active[bb_index].id, bb_amount)
        await self.emit_event("blind_post", {
            "player": active[bb_index].to_dict(),
            "amount": bb_amount,
            "type": "big_blind",
        })

        # 发手牌
        for p in active:
            p.hand = self.deck.deal(2)

        await self.emit_event("deal_hole_cards", {
            "players": [p.to_dict(hide_hand=False) for p in active],
        })

        # Preflop
        self.stage = GameStage.PREFLOP
        preflop_start = (bb_index + 1) % n
        if not await self._run_betting_round(active, preflop_start, is_preflop=True):
            await self._finish_hand(active)
            return

        # Flop
        self.stage = GameStage.FLOP
        self.community_cards.extend(self.deck.deal(3))
        await self.emit_event("community_cards", {
            "stage": "flop",
            "cards": [c.to_dict() for c in self.community_cards],
        })
        for p in active:
            p.reset_for_new_round()
        flop_start = self._first_active_after(active, self.dealer_index)
        if not await self._run_betting_round(active, flop_start):
            await self._finish_hand(active)
            return

        # Turn
        self.stage = GameStage.TURN
        self.community_cards.extend(self.deck.deal(1))
        await self.emit_event("community_cards", {
            "stage": "turn",
            "cards": [c.to_dict() for c in self.community_cards],
        })
        for p in active:
            p.reset_for_new_round()
        turn_start = self._first_active_after(active, self.dealer_index)
        if not await self._run_betting_round(active, turn_start):
            await self._finish_hand(active)
            return

        # River
        self.stage = GameStage.RIVER
        self.community_cards.extend(self.deck.deal(1))
        await self.emit_event("community_cards", {
            "stage": "river",
            "cards": [c.to_dict() for c in self.community_cards],
        })
        for p in active:
            p.reset_for_new_round()
        river_start = self._first_active_after(active, self.dealer_index)
        if not await self._run_betting_round(active, river_start):
            await self._finish_hand(active)
            return

        # Showdown
        await self._finish_hand(active)

    async def _run_betting_round(
        self,
        players: List[Player],
        start_index: int,
        is_preflop: bool = False,
    ) -> bool:
        """
        运行一轮下注。返回 True 表示需要继续下一阶段，False 表示手牌已结束。
        """
        betting = BettingRound(players, start_index, self.big_blind)
        if is_preflop:
            betting.current_bet = self.big_blind
        self.current_betting = betting

        await self.emit_event("betting_round_start", {
            "stage": self.stage.value,
            "pot": self.pot_manager.get_total_pot(),
        })

        while not betting.is_round_complete():
            await self._pause_event.wait()
            if not self.is_running:
                return False

            current_player = betting.get_current_player()
            if current_player is None:
                break

            if not current_player.can_act():
                betting._advance()
                continue

            # 广播当前思考玩家
            self._thinking_player_id = current_player.id
            await self.emit_event("player_thinking", {
                "player_id": current_player.id,
                "player_name": current_player.name,
            })

            # 获取 AI 决策
            available = betting.get_available_actions(current_player)
            action = await self._get_player_action(current_player, available)

            # 执行动作
            await self._execute_action(current_player, action, betting)

            self._thinking_player_id = None
            await self.emit_event("player_action", {
                "player": current_player.to_dict(),
                "action": action["type"],
                "amount": action.get("amount", 0),
                "reasoning": action.get("reasoning", ""),
                "pot": self.pot_manager.get_total_pot(),
                "stage": self.stage.value,
            })

            # 检查是否只剩一个玩家
            in_hand = [p for p in players if p.is_active()]
            if len(in_hand) <= 1:
                return False

            await asyncio.sleep(self.action_delay)

        self.current_betting = None
        return True

    async def _get_player_action(self, player: Player, available: dict) -> dict:
        """获取玩家的决策"""
        if self._ai_decide:
            game_state = self._build_game_state(player, available)
            action = await self._ai_decide(player.id, game_state)
            return action

        # 默认行为：能过牌就过牌，否则弃牌
        if available["can_check"]:
            return {"type": "check"}
        return {"type": "fold"}

    async def _execute_action(self, player: Player, action: dict, betting: BettingRound):
        action_type = action["type"]

        if action_type == "fold":
            betting.process_fold(player)
            self.pot_manager.mark_folded(player.id)
        elif action_type == "check":
            betting.process_check(player)
        elif action_type == "call":
            amount = betting.process_call(player)
            self.pot_manager.add_bet(player.id, amount)
        elif action_type == "raise":
            raise_to = action.get("amount", betting.current_bet + betting.min_raise)
            amount = betting.process_raise(player, raise_to)
            self.pot_manager.add_bet(player.id, amount)
        elif action_type == "all_in":
            amount = betting.process_all_in(player)
            self.pot_manager.add_bet(player.id, amount)

    async def _finish_hand(self, players: List[Player]):
        """手牌结算"""
        self.stage = GameStage.SHOWDOWN
        in_hand = [p for p in players if p.is_active()]

        hand_results: Dict[str, Any] = {}

        if len(in_hand) == 1:
            # 其他人都弃牌
            winner = in_hand[0]
            total_pot = self.pot_manager.get_total_pot()
            winner.chips += total_pot
            hand_results = {
                "winners": [{
                    "player": winner.to_dict(),
                    "amount": total_pot,
                    "hand_rank": "其他人弃牌",
                    "best_five": [],
                }],
                "all_folded": True,
            }
        else:
            # 评估手牌
            player_scores: Dict[str, int] = {}
            player_eval: Dict[str, Any] = {}
            for p in in_hand:
                all_cards = p.hand + self.community_cards
                result = HandEvaluator.evaluate(all_cards)
                player_scores[p.id] = result.score
                player_eval[p.id] = result

            # 分配底池
            winnings = self.pot_manager.distribute(player_scores)

            winners_info = []
            for pid, amount in winnings.items():
                p = next(pp for pp in players if pp.id == pid)
                p.chips += amount
                eval_result = player_eval.get(pid)
                winners_info.append({
                    "player": p.to_dict(),
                    "amount": amount,
                    "hand_rank": eval_result.rank.name_cn() if eval_result else "",
                    "best_five": [c.to_dict() for c in eval_result.best_five] if eval_result else [],
                })

            hand_results = {
                "winners": winners_info,
                "all_folded": False,
                "showdown": [
                    {
                        "player": p.to_dict(),
                        "hand_rank": player_eval[p.id].rank.name_cn(),
                        "best_five": [c.to_dict() for c in player_eval[p.id].best_five],
                        "score": player_eval[p.id].score,
                    }
                    for p in in_hand
                    if p.id in player_eval
                ],
            }

        self.stage = GameStage.HAND_COMPLETE
        hand_results["hand_number"] = self.hand_number
        hand_results["players"] = [p.to_dict() for p in players]

        await self.emit_event("hand_complete", hand_results)

        # 通知 AI 更新记忆
        if self._on_hand_complete:
            await self._on_hand_complete(hand_results)

        # 淘汰筹码归零的玩家
        if self.eliminate_on_zero:
            for p in players:
                if p.chips <= 0 and not p.is_eliminated:
                    p.is_eliminated = True
                    await self.emit_event("player_eliminated", {
                        "player": p.to_dict(),
                    })

        # 轮转庄位
        active_after = self.get_active_players()
        if active_after:
            self.dealer_index = (self.dealer_index + 1) % len(active_after)

    def _build_game_state(self, player: Player, available: dict) -> dict:
        """构建给 AI 的游戏状态"""
        active = self.get_active_players()
        player_idx = next(
            (i for i, p in enumerate(active) if p.id == player.id), 0
        )
        dealer_idx = self.dealer_index % len(active) if active else 0
        position = self._get_position_name(player_idx, dealer_idx, len(active))

        players_info = []
        for p in active:
            info = {
                "name": p.name,
                "chips": p.chips,
                "current_bet": p.current_bet,
                "folded": p.folded,
                "all_in": p.all_in,
                "style": p.style,
                "last_action": p.last_action,
            }
            players_info.append(info)

        return {
            "hand": [c.to_dict() for c in player.hand],
            "community_cards": [c.to_dict() for c in self.community_cards],
            "pot": self.pot_manager.get_total_pot(),
            "current_bet": self.current_betting.current_bet if self.current_betting else 0,
            "my_chips": player.chips,
            "my_bet": player.current_bet,
            "players": players_info,
            "position": position,
            "stage": self.stage.value,
            "min_raise": available.get("min_raise_amount", self.big_blind),
            "big_blind": self.big_blind,
            "available_actions": available,
            "hand_number": self.hand_number,
        }

    def _get_position_name(self, player_idx: int, dealer_idx: int, total: int) -> str:
        offset = (player_idx - dealer_idx) % total
        if total == 2:
            return "BTN/SB" if offset == 0 else "BB"
        position_names = {0: "BTN", 1: "SB", 2: "BB"}
        if offset in position_names:
            return position_names[offset]
        if offset == total - 1:
            return "CO"
        return f"MP{offset - 2}" if offset > 2 else f"UTG+{offset - 3}"

    def _first_active_after(self, players: List[Player], start: int) -> int:
        n = len(players)
        for i in range(n):
            idx = (start + 1 + i) % n
            if players[idx].can_act():
                return idx
        return 0

    # 控制方法
    def pause(self):
        self.is_paused = True
        self._pause_event.clear()

    def resume(self):
        self.is_paused = False
        self._pause_event.set()

    def step(self):
        self._step_event.set()

    def stop(self):
        self.is_running = False
        self._pause_event.set()
        self._step_event.set()

    def get_state(self) -> dict:
        """获取完整游戏状态快照"""
        return {
            "stage": self.stage.value,
            "hand_number": self.hand_number,
            "big_blind": self.big_blind,
            "small_blind": self.small_blind,
            "pot": self.pot_manager.get_total_pot(),
            "community_cards": [c.to_dict() for c in self.community_cards],
            "players": [p.to_dict(hide_hand=False) for p in self.players],
            "dealer_index": self.dealer_index,
            "sb_index": self._sb_index,
            "bb_index": self._bb_index,
            "is_paused": self.is_paused,
            "is_running": self.is_running,
            "max_hands": self.max_hands,
            "thinking_player_id": self._thinking_player_id,
        }
