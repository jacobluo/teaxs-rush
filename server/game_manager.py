"""游戏会话管理器：桥接 WebSocket、GameController 和 AI 模块"""

import asyncio
import logging
from typing import Set, Optional, Dict
from datetime import datetime

from fastapi import WebSocket

from game.player import Player
from game.controller import GameController
from ai.llm_player import LLMAIPlayer
from ai.prompt_builder import PromptBuilder
from server.model_store import model_store
from server.config_store import config_store
from server.schemas import GameConfig, GameEvent

logger = logging.getLogger(__name__)


class GameManager:
    """游戏管理器单例"""

    def __init__(self):
        self.controller: Optional[GameController] = None
        self.ai_players: Dict[str, LLMAIPlayer] = {}
        self.connections: Set[WebSocket] = set()
        self._game_task: Optional[asyncio.Task] = None
        self._config: Optional[GameConfig] = None

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.connections.add(websocket)
        # 发送当前状态快照
        if self.controller:
            state = self.controller.get_state()
            await self._send_to(websocket, "game_state", state)

    def disconnect(self, websocket: WebSocket):
        self.connections.discard(websocket)

    async def broadcast(self, event_type: str, data: dict):
        event = GameEvent(type=event_type, data=data)
        message = event.model_dump()
        dead_connections = set()

        for ws in self.connections:
            try:
                await ws.send_json(message)
            except Exception:
                dead_connections.add(ws)

        self.connections -= dead_connections

    async def _send_to(self, websocket: WebSocket, event_type: str, data: dict):
        event = GameEvent(type=event_type, data=data)
        try:
            await websocket.send_json(event.model_dump())
        except Exception:
            self.connections.discard(websocket)

    async def configure_game(self, config: GameConfig):
        """配置游戏（管理员操作）"""
        # 如果游戏正在运行，先停止
        if self.controller and self.controller.is_running:
            self.controller.stop()
            if self._game_task:
                await self._game_task

        self._config = config
        self.ai_players.clear()

        # 创建玩家和 AI
        players = []
        for i, pc in enumerate(config.players):
            player = Player(
                id=f"player_{i}",
                name=pc.name,
                chips=config.starting_chips,
                style=pc.style,
                model_id=pc.model_id,
            )
            players.append(player)

            # 获取模型配置并创建 AI
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
        ai = self.ai_players.get(player_id)
        if ai:
            return await ai.decide(game_state)
        # 没有 AI，使用默认行为
        available = game_state.get("available_actions", {})
        if available.get("can_check"):
            return {"type": "check", "amount": 0, "reasoning": "无AI配置，自动过牌"}
        return {"type": "fold", "amount": 0, "reasoning": "无AI配置，自动弃牌"}

    async def _on_hand_complete(self, hand_result: dict):
        """每手牌结束后更新所有 AI 的记忆"""
        for player_id, ai in self.ai_players.items():
            summary = PromptBuilder.build_hand_summary(hand_result, ai.name)
            ai.update_memory(summary)

    async def start_game(self):
        if not self.controller:
            return
        if self.controller.is_running:
            return

        self._game_task = asyncio.create_task(self.controller.run_game())

    async def pause_game(self):
        if self.controller and self.controller.is_running:
            self.controller.pause()
            await self.broadcast("game_paused", {})

    async def resume_game(self):
        if self.controller and self.controller.is_paused:
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
            self.controller.stop()
            if self._game_task:
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

        await self.broadcast("game_reset", {})

    def get_state(self) -> dict:
        if self.controller:
            return self.controller.get_state()
        return {"stage": "waiting", "is_running": False}


# 全局单例
game_manager = GameManager()
