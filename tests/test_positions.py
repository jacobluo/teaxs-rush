import unittest
from game.controller import GameController, GameStage
from game.player import Player


class PositionTests(unittest.IsolatedAsyncioTestCase):
    async def test_first_actor_follows_betting_order_and_survives_actions(self):
        players = [Player(str(i), str(i)) for i in range(4)]
        controller = GameController(players)
        controller.stage = GameStage.FLOP
        players[1].folded = True
        players[2].all_in = True
        await controller._run_betting_round(players, 1)
        self.assertEqual(controller.get_state()['first_actor_id'], '3')
        controller.current_betting._advance()
        self.assertEqual(controller.get_state()['first_actor_id'], '3')
        controller.stage = GameStage.TURN
        self.assertIsNone(controller.get_state()['first_actor_id'])

    async def test_heads_up_dealer_starts_preflop_big_blind_starts_flop(self):
        controller = GameController([Player('a','a'), Player('b','b')])
        controller.stage = GameStage.PREFLOP
        await controller._run_betting_round(controller.players, 0, True)
        self.assertEqual(controller.get_state()['first_actor_id'], 'a')
        controller.stage = GameStage.FLOP
        await controller._run_betting_round(controller.players, 1)
        self.assertEqual(controller.get_state()['first_actor_id'], 'b')

    async def test_hand_positions_remain_attached_to_players_after_elimination(self):
        async def stop_at_start(event_type, data):
            if event_type == 'hand_start':
                raise RuntimeError('stop fixture')
        controller = GameController([Player(str(i),str(i)) for i in range(6)],on_event=stop_at_start)
        with self.assertRaisesRegex(RuntimeError,'stop fixture'):
            await controller._play_one_hand()
        expected = {'0':'BTN','1':'SB','2':'BB','3':'UTG','4':'HJ','5':'CO'}
        self.assertEqual(controller.get_state()['seat_positions'],expected)
        controller.players[1].is_eliminated = True
        controller.dealer_index = 1
        self.assertEqual(controller.get_state()['seat_positions'],expected)
