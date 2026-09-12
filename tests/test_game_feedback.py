import unittest
from unittest.mock import AsyncMock, patch

from game.controller import GameController
from game.player import Player


class GameFeedbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_result_is_available_during_five_second_hold_and_after_game_over(self):
        held = []
        starts = []
        controller = GameController([Player('a', 'Alice'), Player('b', 'Bob')], max_hands=2, action_delay=0)

        async def event(kind, data):
            if kind == 'hand_start':
                starts.append(controller.get_state().get('hand_result'))

        async def sleep(seconds):
            if seconds == 5:
                snapshot = controller.get_state()
                self.assertEqual(snapshot['stage'], 'hand_complete')
                held.append(snapshot['hand_result'])
                self.assertEqual(snapshot['hand_result']['hand_number'], snapshot['hand_number'])

        controller.on_event = event
        with patch('game.controller.asyncio.sleep', new=AsyncMock(side_effect=sleep)):
            await controller.run_game()
        self.assertEqual(len(held), 2)
        self.assertTrue(held[0]['winners'])
        self.assertEqual(starts, [None, None])
        self.assertEqual(controller.get_state()['hand_result']['hand_number'], 2)

    async def test_action_event_reports_chips_actually_committed_for_all_in(self):
        events = []
        controller = GameController([Player('a', 'Alice', chips=100), Player('b', 'Bob', chips=100)], max_hands=1, action_delay=0)
        controller.set_ai_callback(AsyncMock(return_value={'type': 'all_in', 'amount': 0}))
        async def event(kind, data):
            if kind == 'player_action':
                events.append(data)
        controller.on_event = event
        with patch('game.controller.asyncio.sleep', new=AsyncMock()):
            await controller.run_game()
        self.assertEqual(events[0]['amount'], 50)

    async def test_new_street_clears_actions_before_broadcast_and_allows_reading_time(self):
        controller = GameController([Player('a', 'Alice'), Player('b', 'Bob')], max_hands=1, action_delay=0)
        streets = []
        held = []

        async def decide(player_id, state):
            available = state['available_actions']
            return {'type': 'check' if available['can_check'] else 'call'}

        async def event(kind, data):
            if kind == 'community_cards':
                streets.append(data['stage'])
                for player in controller.get_state()['players']:
                    self.assertEqual(player['last_action'], '')
                    self.assertEqual(player['current_bet'], 0)

        async def sleep(seconds):
            if seconds == 2:
                held.append(controller.stage.value)

        controller.set_ai_callback(decide)
        controller.on_event = event
        with patch('game.controller.asyncio.sleep', new=AsyncMock(side_effect=sleep)):
            await controller.run_game()
        self.assertEqual(streets, ['flop', 'turn', 'river'])
        self.assertEqual(held, streets)
