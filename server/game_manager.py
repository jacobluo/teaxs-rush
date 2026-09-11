"""游戏会话管理器：桥接 WebSocket、GameController 和 AI 模块"""

import asyncio
import logging
import time
from typing import Set, Optional, Dict

from fastapi import WebSocket

from game.player import Player
from game.actions import normalize_action
from game.controller import GameController
from ai.llm_player import LLMAIPlayer
from ai.prompt_builder import PromptBuilder
from server.model_store import model_store
from server.config_store import config_store
from server.schemas import AIPlayerConfig, GameConfig, GameEvent

logger = logging.getLogger(__name__)


class GameManager:
    """游戏管理器单例"""

    def __init__(self):
        self.controller: Optional[GameController] = None
        self.ai_players: Dict[str, LLMAIPlayer] = {}
        self.connections: Set[WebSocket] = set()
        self._game_task: Optional[asyncio.Task] = None
        self._config: Optional[GameConfig] = None
        self._pending_human_action: Optional[dict] = None
        self._pending_human_future: Optional[asyncio.Future] = None
        self._human_action_counter = 0
        self._human_action_timeout = 120.0
        self._paused_human_remaining = None

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.connections.add(websocket)
        # 发送当前状态快照
        if self.controller:
            state = self.get_state()
            await self._send_to(websocket, "game_state", state)

    def disconnect(self, websocket: WebSocket):
        self.connections.discard(websocket)

    async def broadcast(self, event_type: str, data: dict):
        data = self._table_view(data, reveal=event_type in ("hand_complete", "game_over"))
        event = GameEvent(type=event_type, data=data)
        message = event.model_dump()
        dead_connections = set()

        for ws in self.connections:
            try:
                await ws.send_json(message)
            except Exception:
                dead_connections.add(ws)

        self.connections -= dead_connections

    def _table_view(self, data, reveal=False):
        """Keep AI hole cards and decision reasoning private in human games."""
        if not self._config or not any(p.player_type == "human" for p in self._config.players):
            return data
        if isinstance(data, list):
            return [self._table_view(item, reveal) for item in data]
        if not isinstance(data, dict):
            return data
        result = {key: self._table_view(value, reveal) for key, value in data.items()}
        if not reveal:
            if result.get("player_type") == "ai" and "hand" in result:
                result["hand"] = []
            if "reasoning" in result and result.get("player", {}).get("player_type") == "ai":
                result["reasoning"] = ""
        return result

    async def _send_to(self, websocket: WebSocket, event_type: str, data: dict):
        event = GameEvent(type=event_type, data=data)
        try:
            await websocket.send_json(event.model_dump())
        except Exception:
            self.connections.discard(websocket)

    async def configure_game(self, config: GameConfig, persist: bool = True):
        """配置游戏（管理员操作）"""
        human_count = sum(1 for pc in config.players if pc.player_type == "human")
        if human_count > 1:
            raise ValueError("当前版本最多支持 1 位人类玩家")
        # 如果游戏正在运行，先停止
        if self.controller and self.controller.is_running:
            self._resolve_pending_human_action(reason="游戏重新配置")
            self.controller.stop()
            if self._game_task:
                await self._game_task

        self._config = config
        self.ai_players.clear()
        self._pending_human_action = None
        self._pending_human_future = None

        # 创建玩家和 AI
        players = []
        for i, pc in enumerate(config.players):
            player = Player(
                id=f"player_{i}",
                name=pc.name,
                chips=config.starting_chips,
                style=pc.style,
                model_id=pc.model_id,
                player_type=pc.player_type,
                controller_id=pc.controller_id or "admin",
            )
            players.append(player)

            # 获取模型配置并创建 AI
            if pc.player_type != "ai":
                continue
            model = await model_store.get_by_id(pc.model_id)
            if model:
                ai = LLMAIPlayer(
                    player_id=player.id,
                    name=pc.name,
                    style=pc.style,
                    api_key=model.api_key,
                    base_url=model.base_url,
                    model_name=model.model_name,
                )
                self.ai_players[player.id] = ai

        # 创建控制器
        self.controller = GameController(
            players=players,
            big_blind=config.big_blind,
            starting_chips=config.starting_chips,
            max_hands=config.max_hands,
            action_delay=config.action_delay,
            eliminate_on_zero=config.eliminate_on_zero,
            blind_increase_interval=config.blind_increase_interval,
            on_event=self._on_game_event,
        )
        self.controller.set_ai_callback(self._ai_decide)
        self.controller.set_hand_complete_callback(self._on_hand_complete)

        # 持久化游戏配置（玩家信息 + 游戏参数）
        if persist:
            await config_store.save(config.model_dump())

        await self.broadcast("game_configured", {
            "players": [p.to_dict() for p in players],
            "config": config.model_dump(),
        })

    async def _on_game_event(self, event_type: str, data: dict):
        """游戏事件回调 -> 广播到所有客户端"""
        await self.broadcast(event_type, data)

    async def _ai_decide(self, player_id: str, game_state: dict) -> dict:
        """AI 决策回调"""
        player = self._get_player(player_id)
        if player and player.player_type == "human":
            return await self._wait_for_human_action(player, game_state)

        ai = self.ai_players.get(player_id)
        if ai:
            return await ai.decide(game_state)
        # 内置练习对手：小额跟注，免费过牌，面对大额下注谨慎弃牌。
        available = game_state.get("available_actions", {})
        if available.get("can_check"):
            return {"type": "check", "amount": 0, "reasoning": "电脑对手过牌"}
        affordable = max(game_state.get("big_blind", 100) * 2,
                         game_state.get("my_chips", 0) // 4)
        if available.get("can_call") and available.get("to_call", 0) <= affordable:
            return {"type": "call", "amount": available["to_call"], "reasoning": "电脑对手跟注"}
        return {"type": "fold", "amount": 0, "reasoning": "电脑对手弃牌"}

    async def start_practice(self):
        """Start a playable local-bot table without overwriting the saved setup."""
        if self.controller and self.controller.is_running:
            raise ValueError("牌局进行中，请先结束或重置当前牌局")
        await self.configure_game(GameConfig(players=[
            AIPlayerConfig(name="我", style="均衡", player_type="human"),
            AIPlayerConfig(name="阿岚", style="保守"),
            AIPlayerConfig(name="小狐狸", style="诡计"),
            AIPlayerConfig(name="老陈", style="均衡"),
        ], max_hands=10, action_delay=0.8), persist=False)
        await self.start_game()

    def _get_player(self, player_id: str) -> Optional[Player]:
        if not self.controller:
            return None
        return next((p for p in self.controller.players if p.id == player_id), None)

    async def _wait_for_human_action(self, player: Player, game_state: dict) -> dict:
        """Broadcast an action request and wait for the admin-controlled human seat."""
        available = game_state.get("available_actions", {})
        self._human_action_counter += 1
        request_id = (
            f"{player.id}-{game_state.get('hand_number', 0)}-"
            f"{self._human_action_counter}"
        )
        loop = asyncio.get_running_loop()
        future = loop.create_future()

        self._pending_human_action = {
            "request_id": request_id,
            "player_id": player.id,
            "player_name": player.name,
            "controller_id": player.controller_id,
            "stage": game_state.get("stage", ""),
            "hand_number": game_state.get("hand_number", 0),
            "available_actions": available,
            "expires_at": time.time() + self._human_action_timeout,
        }
        self._pending_human_future = future
        self._paused_human_remaining = None
        await self.broadcast("human_action_request", self._pending_human_action)

        try:
            while not future.done():
                if self.controller and self.controller.is_paused:
                    await self.controller._pause_event.wait()
                    continue
                deadline = self._pending_human_action.get("expires_at")
                remaining = max(0, deadline - time.time()) if deadline else self._human_action_timeout
                if remaining == 0:
                    raise asyncio.TimeoutError
                await asyncio.wait({future}, timeout=remaining)
            action = future.result()
        except asyncio.TimeoutError:
            action = self._default_human_timeout_action(available)
            await self.broadcast("human_action_timeout", {
                "request_id": request_id,
                "player_id": player.id,
                "player_name": player.name,
                "action": action,
            })
        finally:
            if (
                self._pending_human_action
                and self._pending_human_action.get("request_id") == request_id
            ):
                self._pending_human_action = None
                self._pending_human_future = None
                self._paused_human_remaining = None
                await self.broadcast("human_action_clear", {"request_id": request_id})

        action["reasoning"] = action.get("reasoning") or "人类玩家操作"
        return action

    def _default_human_timeout_action(self, available: dict) -> dict:
        if available.get("can_check"):
            return {
                "type": "check",
                "amount": 0,
                "reasoning": "人类玩家超时，自动过牌",
            }
        return {
            "type": "fold",
            "amount": 0,
            "reasoning": "人类玩家超时，自动弃牌",
        }

    async def submit_human_action(
        self,
        request_id: str,
        action_type: str,
        amount: int = 0,
    ) -> dict:
        """Submit the admin's action for the currently pending human seat."""
        pending = self._pending_human_action
        future = self._pending_human_future
        if not pending or not future or future.done():
            return {"status": "error", "message": "当前没有等待中的人类玩家操作"}
        if request_id != pending.get("request_id"):
            return {"status": "error", "message": "操作请求已过期"}
        if self.controller and self.controller.is_paused:
            return {"status": "error", "message": "牌局已暂停，请先继续"}

        action = normalize_action(
            action_type,
            amount,
            pending.get("available_actions", {}),
        )
        action["reasoning"] = "人类玩家操作"
        future.set_result(action)
        return {"status": "ok", "action": action}

    def _resolve_pending_human_action(self, reason: str = ""):
        pending = self._pending_human_action
        future = self._pending_human_future
        if not pending or not future or future.done():
            return
        action = self._default_human_timeout_action(
            pending.get("available_actions", {})
        )
        if reason:
            action["reasoning"] = reason
        future.set_result(action)

    def get_pending_human_action(self) -> Optional[dict]:
        if not self._pending_human_action:
            return None
        return dict(self._pending_human_action)

    async def _on_hand_complete(self, hand_result: dict):
        """每手牌结束后更新所有 AI 的记忆"""
        for player_id, ai in self.ai_players.items():
            summary = PromptBuilder.build_hand_summary(hand_result, ai.name)
            ai.update_memory(summary)

    async def start_game(self):
        if not self.controller:
            return
        if self.controller.is_running or (self._game_task and not self._game_task.done()):
            return

        self.controller.is_running = True
        self._game_task = asyncio.create_task(self.controller.run_game())

    async def pause_game(self):
        if self.controller and self.controller.is_running:
            pending = self._pending_human_action
            if pending and pending.get("expires_at") is not None:
                self._paused_human_remaining = max(0, pending["expires_at"] - time.time())
                pending["expires_at"] = None
            self.controller.pause()
            await self.broadcast("game_paused", {})

    async def resume_game(self):
        if self.controller and self.controller.is_paused:
            if self._pending_human_action and self._paused_human_remaining is not None:
                self._pending_human_action["expires_at"] = time.time() + self._paused_human_remaining
                self._paused_human_remaining = None
            self.controller.resume()
            await self.broadcast("game_resumed", {})

    async def step_game(self):
        if self.controller:
            self.controller.step_mode = True
            if self.controller.is_paused:
                self.controller.resume()
            self.controller.step()

    async def reset_game(self):
        if self.controller:
            self._resolve_pending_human_action(reason="游戏重置，自动处理人类玩家操作")
            self.controller.stop()
            if self._game_task:
                self._game_task.cancel()
                try:
                    await asyncio.wait_for(self._game_task, timeout=5)
                except (asyncio.TimeoutError, asyncio.CancelledError):
                    pass

        # 清空 AI 记忆
        for ai in self.ai_players.values():
            ai.clear_memory()

        self.controller = None
        self.ai_players.clear()
        self._game_task = None
        self._pending_human_action = None
        self._pending_human_future = None

        await self.broadcast("game_reset", {})

    def get_state(self) -> dict:
        if self.controller:
            state = self.controller.get_state()
            state["pending_human_action"] = self.get_pending_human_action()
            return self._table_view(state, reveal=state["stage"] in ("showdown", "hand_complete", "game_over"))
        return {
            "stage": "waiting",
            "is_running": False,
            "is_paused": False,
            "hand_number": 0,
            "players": [],
            "community_cards": [],
            "pot": 0,
            "small_blind": 50,
            "big_blind": 100,
            "pending_human_action": self.get_pending_human_action(),
        }


# 全局单例
game_manager = GameManager()
