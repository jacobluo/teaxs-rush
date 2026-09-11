import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from game.actions import normalize_action
from server.game_manager import GameManager, config_store
from server.schemas import AIPlayerConfig, GameConfig
from game.controller import GameStage


class ActionValidationTests(unittest.TestCase):
    def test_normalize_raise_clamps_to_available_range(self):
        available = {
            "can_fold": True,
            "can_check": False,
            "can_call": True,
            "can_raise": True,
            "can_all_in": True,
            "to_call": 100,
            "min_raise_to": 300,
            "max_raise_to": 900,
        }

        action = normalize_action("raise", 50, available)

        self.assertEqual(action, {"type": "raise", "amount": 300})

    def test_normalize_invalid_action_prefers_check_then_call_then_fold(self):
        available = {
            "can_fold": True,
            "can_check": True,
            "can_call": False,
            "can_raise": False,
            "can_all_in": False,
            "to_call": 0,
        }

        action = normalize_action("dance", 0, available)

        self.assertEqual(action, {"type": "check", "amount": 0})


class HumanPlayerManagerTests(unittest.IsolatedAsyncioTestCase):
    async def test_pause_preserves_human_turn_past_original_timeout(self):
        manager = GameManager()
        config = GameConfig(players=[
            AIPlayerConfig(name="我", style="均衡", player_type="human"),
            AIPlayerConfig(name="电脑", style="均衡"),
        ])
        await manager.configure_game(config, persist=False)
        manager.controller.is_running = True
        manager._human_action_timeout = 0.02
        task = asyncio.create_task(manager._ai_decide("player_0", {
            "available_actions": {"can_check": True},
        }))
        await asyncio.sleep(0)
        await manager.pause_game()
        try:
            await asyncio.sleep(0.04)
            self.assertFalse(task.done())
            request = manager.get_pending_human_action()
            self.assertIsNone(request["expires_at"])
            await manager.resume_game()
            await manager.submit_human_action(request["request_id"], "check")
            self.assertEqual((await task)["type"], "check")
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def test_human_table_hides_opponent_cards_until_showdown(self):
        manager = GameManager()
        config = GameConfig(players=[
            AIPlayerConfig(name="我", style="均衡", player_type="human"),
            AIPlayerConfig(name="电脑", style="均衡"),
        ])
        with patch.object(config_store, "save", new=AsyncMock()):
            await manager.configure_game(config)
        for player in manager.controller.players:
            player.hand = manager.controller.deck.deal(2)
        manager.controller.stage = GameStage.PREFLOP
        state = manager.get_state()
        self.assertEqual(len(state["players"][0]["hand"]), 2)
        self.assertEqual(state["players"][1]["hand"], [])
        socket = AsyncMock()
        manager.connections.add(socket)
        await manager.broadcast("deal_hole_cards", {
            "players": [p.to_dict() for p in manager.controller.players],
        })
        self.assertEqual(socket.send_json.call_args.args[0]["data"]["players"][1]["hand"], [])
        manager.controller.stage = GameStage.HAND_COMPLETE
        self.assertEqual(len(manager.get_state()["players"][1]["hand"]), 2)

    async def test_reconnecting_receives_pending_turn_in_snapshot(self):
        manager = GameManager()
        manager.controller = unittest.mock.Mock()
        manager.controller.get_state.return_value = {"stage": "preflop"}
        manager._pending_human_action = {"request_id": "turn-1"}
        socket = AsyncMock()
        await manager.connect(socket)
        snapshot = socket.send_json.call_args.args[0]["data"]
        self.assertEqual(snapshot["pending_human_action"], {"request_id": "turn-1"})

    async def test_builtin_opponent_calls_affordable_bet(self):
        manager = GameManager()
        action = await manager._ai_decide("bot", {
            "hand": [{"rank": "A", "suit": "spades"}, {"rank": "K", "suit": "hearts"}],
            "my_chips": 1000, "big_blind": 100,
            "available_actions": {"can_call": True, "to_call": 50},
        })
        self.assertEqual(action["type"], "call")

    async def test_practice_keeps_saved_configuration_and_creates_human_seat(self):
        manager = GameManager()
        with patch.object(config_store, "save", new=AsyncMock()) as save:
            await manager.start_practice()
            self.assertTrue(manager.controller.is_running)
            with self.assertRaisesRegex(ValueError, "进行中"):
                await manager.start_practice()
            self.assertEqual(manager.controller.players[0].player_type, "human")
            self.assertEqual(len(manager.controller.players), 4)
            self.assertTrue(all(not p.model_id for p in manager.controller.players))
            save.assert_not_called()
            await manager.reset_game()

    async def test_practice_does_not_replace_running_table(self):
        manager = GameManager()
        manager.controller = unittest.mock.Mock(is_running=True)
        with self.assertRaisesRegex(ValueError, "进行中"):
            await manager.start_practice()

    async def test_configure_game_allows_one_human_player_without_model(self):
        manager = GameManager()
        config = GameConfig(
            players=[
                AIPlayerConfig(name="我", style="均衡", player_type="human"),
                AIPlayerConfig(name="AI-1", style="激进", model_id="missing-model"),
            ],
            max_hands=1,
        )

        with patch.object(config_store, "save", new=AsyncMock()):
            await manager.configure_game(config)

        self.assertIsNotNone(manager.controller)
        self.assertEqual(manager.controller.players[0].player_type, "human")
        self.assertEqual(manager.controller.players[0].controller_id, "admin")
        self.assertNotIn("player_0", manager.ai_players)

    async def test_human_decision_waits_for_matching_submitted_action(self):
        manager = GameManager()
        config = GameConfig(
            players=[
                AIPlayerConfig(name="我", style="均衡", player_type="human"),
                AIPlayerConfig(name="AI-1", style="激进", model_id="missing-model"),
            ],
            max_hands=1,
        )
        with patch.object(config_store, "save", new=AsyncMock()):
            await manager.configure_game(config)
        game_state = {
            "stage": "preflop",
            "hand_number": 1,
            "available_actions": {
                "can_fold": True,
                "can_check": False,
                "can_call": True,
                "can_raise": True,
                "can_all_in": True,
                "to_call": 100,
                "min_raise_to": 300,
                "max_raise_to": 1000,
            },
        }

        decision_task = asyncio.create_task(manager._ai_decide("player_0", game_state))
        await asyncio.sleep(0)
        pending = manager.get_pending_human_action()

        self.assertIsNotNone(pending)
        self.assertEqual(pending["player_id"], "player_0")
        self.assertEqual(pending["controller_id"], "admin")

        stale = await manager.submit_human_action("wrong-request", "call", 100)
        self.assertEqual(stale["status"], "error")

        submitted = await manager.submit_human_action(pending["request_id"], "raise", 9999)
        self.assertEqual(submitted["status"], "ok")

        action = await decision_task
        self.assertEqual(action["type"], "raise")
        self.assertEqual(action["amount"], 1000)
        self.assertEqual(action["reasoning"], "人类玩家操作")
        self.assertIsNone(manager.get_pending_human_action())


if __name__ == "__main__":
    unittest.main()
