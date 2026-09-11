import unittest
import logging
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from main import app
from server.game_manager import config_store, game_manager

logging.getLogger("httpx").setLevel(logging.WARNING)


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


class WebAppE2ETests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self._clear_game_manager()

    def tearDown(self):
        self._clear_game_manager()

    def _clear_game_manager(self):
        if game_manager.controller:
            game_manager.controller.stop()
        game_manager.controller = None
        game_manager.ai_players.clear()
        game_manager._game_task = None
        game_manager._pending_human_action = None
        game_manager._pending_human_future = None

    def _login(self) -> str:
        response = self.client.post(
            "/api/auth/login",
            json={"password": "texas2024"},
        )
        self.assertEqual(response.status_code, 200)
        token = response.json()["token"]
        self.assertTrue(token)
        return token

    def _human_game_config(self) -> dict:
        return {
            "players": [
                {
                    "name": "真人",
                    "style": "均衡",
                    "model_id": "",
                    "player_type": "human",
                    "controller_id": "admin",
                },
                {
                    "name": "AI-1",
                    "style": "激进",
                    "model_id": "missing-model",
                    "player_type": "ai",
                    "controller_id": "admin",
                },
            ],
            "big_blind": 100,
            "starting_chips": 1000,
            "max_hands": 1,
            "action_delay": 0,
            "eliminate_on_zero": True,
            "blind_increase_interval": 0,
        }

    def test_homepage_serves_human_action_ui_assets(self):
        response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        html = response.text
        self.assertIn("humanActionPanel", html)
        self.assertIn("/static/js/app.js", html)
        self.assertIn("/static/js/config_panel.js", html)

    def test_human_can_play_every_street_to_settlement_with_builtin_opponent(self):
        token = self._login()
        with patch.object(config_store, "save", new=AsyncMock()):
            self.client.post("/api/game/config", headers=auth_header(token), json=self._human_game_config())
        streets = set()
        completed = None
        with self.client.websocket_connect("/ws") as websocket:
            websocket.send_json({"type": "start", "token": token})
            for _ in range(100):
                message = websocket.receive_json()
                if message["type"] == "human_action_request":
                    request = message["data"]
                    streets.add(request["stage"])
                    websocket.send_json({
                        "type": "human_action", "token": token,
                        "request_id": request["request_id"],
                        "action": "check" if request["available_actions"]["can_check"] else "call",
                    })
                elif message["type"] == "hand_complete":
                    completed = message["data"]
                elif message["type"] == "game_over":
                    break
        self.assertEqual(streets, {"preflop", "flop", "turn", "river"})
        self.assertIsNotNone(completed)
        self.assertEqual(sum(p["chips"] for p in completed["players"]), 2000)

    def test_practice_requires_room_login(self):
        self.assertEqual(self.client.post("/api/game/practice").status_code, 401)

    def test_auth_protects_admin_apis_and_accepts_valid_login(self):
        unauthorized = self.client.get("/api/models")
        self.assertEqual(unauthorized.status_code, 401)

        token = self._login()
        verified = self.client.get("/api/auth/verify", headers=auth_header(token))

        self.assertEqual(verified.status_code, 200)
        self.assertEqual(verified.json()["role"], "admin")

    def test_configure_game_accepts_one_human_player_and_rejects_two(self):
        token = self._login()

        with patch.object(config_store, "save", new=AsyncMock()):
            response = self.client.post(
                "/api/game/config",
                headers=auth_header(token),
                json=self._human_game_config(),
            )

        self.assertEqual(response.status_code, 200)
        state = self.client.get("/api/game/state").json()
        self.assertEqual(state["players"][0]["player_type"], "human")
        self.assertEqual(state["players"][0]["controller_id"], "admin")

        invalid_config = self._human_game_config()
        invalid_config["players"][1]["player_type"] = "human"
        invalid_config["players"][1]["model_id"] = ""

        with patch.object(config_store, "save", new=AsyncMock()):
            invalid = self.client.post(
                "/api/game/config",
                headers=auth_header(token),
                json=invalid_config,
            )

        self.assertEqual(invalid.status_code, 400)
        self.assertIn("最多支持 1 位人类玩家", invalid.json()["detail"])

    def test_websocket_requests_and_accepts_human_action(self):
        token = self._login()
        with patch.object(config_store, "save", new=AsyncMock()):
            configured = self.client.post(
                "/api/game/config",
                headers=auth_header(token),
                json=self._human_game_config(),
            )
        self.assertEqual(configured.status_code, 200)

        with self.client.websocket_connect("/ws") as websocket:
            websocket.send_json({"type": "start", "token": token})

            request = None
            for _ in range(20):
                message = websocket.receive_json()
                if message["type"] == "human_action_request":
                    request = message["data"]
                    break

            self.assertIsNotNone(request)
            self.assertEqual(request["player_id"], "player_0")
            self.assertEqual(request["controller_id"], "admin")
            self.assertIn("available_actions", request)

            websocket.send_json({
                "type": "human_action",
                "token": token,
                "request_id": request["request_id"],
                "action": "fold",
                "amount": 0,
            })

            player_action = None
            for _ in range(20):
                message = websocket.receive_json()
                if (
                    message["type"] == "player_action"
                    and message["data"]["player"]["id"] == "player_0"
                ):
                    player_action = message["data"]
                    break

            self.assertIsNotNone(player_action)
            self.assertEqual(player_action["action"], "fold")
            self.assertEqual(player_action["reasoning"], "人类玩家操作")


if __name__ == "__main__":
    unittest.main()
