import unittest

from game.betting import BettingRound
from game.player import Player


class BettingRoundTests(unittest.TestCase):
    def test_short_stack_cannot_offer_raise_below_minimum(self):
        player = Player(id="short", name="short", chips=150)
        opponent = Player(id="other", name="other", chips=1000)
        betting = BettingRound([player, opponent], 0, 100)
        betting.current_bet = 100
        actions = betting.get_available_actions(player)
        self.assertFalse(actions["can_raise"])
        self.assertTrue(actions["can_all_in"])

    def test_initial_action_order_starts_from_requested_seat(self):
        players = [
            Player(id="a", name="A"),
            Player(id="b", name="B"),
            Player(id="c", name="C"),
        ]

        betting = BettingRound(players, starting_index=1, big_blind=100)

        self.assertEqual(betting.get_current_player().id, "b")

    def test_raise_resets_action_to_other_active_players(self):
        players = [
            Player(id="a", name="A"),
            Player(id="b", name="B"),
            Player(id="c", name="C"),
        ]
        betting = BettingRound(players, starting_index=0, big_blind=100)
        betting.current_bet = 100

        actual = betting.process_raise(players[0], raise_to=300)

        self.assertEqual(actual, 300)
        self.assertEqual(betting.current_bet, 300)
        self.assertEqual(betting.get_current_player().id, "b")

    def test_available_actions_require_all_in_when_call_equals_stack(self):
        player = Player(id="a", name="A", chips=100)
        betting = BettingRound([player], starting_index=0, big_blind=100)
        betting.current_bet = 100

        actions = betting.get_available_actions(player)

        self.assertFalse(actions["can_call"])
        self.assertTrue(actions["can_all_in"])
        self.assertEqual(actions["to_call"], 100)

    def test_all_in_call_marks_player_and_advances_round(self):
        player = Player(id="a", name="A", chips=100)
        betting = BettingRound([player], starting_index=0, big_blind=100)
        betting.current_bet = 200

        actual = betting.process_all_in(player)

        self.assertEqual(actual, 100)
        self.assertTrue(player.all_in)
        self.assertTrue(player.has_acted)
        self.assertEqual(player.last_action, "ALL IN (CALL)")


if __name__ == "__main__":
    unittest.main()

class AllInResponseTests(unittest.TestCase):
    def test_checked_player_must_respond_after_opponent_goes_all_in(self):
        a = Player('a', 'Alice', chips=1000)
        b = Player('b', 'Bob', chips=1000)
        betting = BettingRound([a, b], 0, 100)
        betting.process_check(a)
        betting.process_all_in(b)
        self.assertFalse(betting.is_round_complete())
        self.assertEqual(betting.get_current_player().id, 'a')
        betting.process_fold(a)
        self.assertTrue(betting.is_round_complete())
