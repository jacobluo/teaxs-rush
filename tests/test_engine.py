import unittest

from engine.card import Card, Deck, Rank, Suit
from engine.evaluator import HandEvaluator, HandRank
from engine.pot import PotManager


def card(rank: Rank, suit: Suit) -> Card:
    return Card(suit=suit, rank=rank)


class DeckTests(unittest.TestCase):
    def test_deck_deals_52_unique_cards(self):
        deck = Deck()

        dealt = deck.deal(52)

        self.assertEqual(len(dealt), 52)
        self.assertEqual(len(set(dealt)), 52)
        self.assertEqual(deck.remaining, 0)

    def test_dealing_too_many_cards_raises(self):
        deck = Deck()

        with self.assertRaises(ValueError):
            deck.deal(53)


class HandEvaluatorTests(unittest.TestCase):
    def test_wheel_straight_uses_five_as_high_card(self):
        cards = [
            card(Rank.ACE, Suit.SPADES),
            card(Rank.TWO, Suit.HEARTS),
            card(Rank.THREE, Suit.DIAMONDS),
            card(Rank.FOUR, Suit.CLUBS),
            card(Rank.FIVE, Suit.SPADES),
        ]

        result = HandEvaluator.evaluate(cards)

        self.assertEqual(result.rank, HandRank.STRAIGHT)
        self.assertIn("5", result.description)

    def test_best_five_from_seven_cards_prefers_full_house_over_flush(self):
        cards = [
            card(Rank.ACE, Suit.SPADES),
            card(Rank.ACE, Suit.HEARTS),
            card(Rank.ACE, Suit.DIAMONDS),
            card(Rank.KING, Suit.SPADES),
            card(Rank.KING, Suit.HEARTS),
            card(Rank.NINE, Suit.SPADES),
            card(Rank.TWO, Suit.SPADES),
        ]

        result = HandEvaluator.evaluate(cards)

        self.assertEqual(result.rank, HandRank.FULL_HOUSE)

    def test_higher_ranked_hand_scores_above_lower_ranked_hand(self):
        straight = HandEvaluator.evaluate([
            card(Rank.NINE, Suit.SPADES),
            card(Rank.EIGHT, Suit.HEARTS),
            card(Rank.SEVEN, Suit.DIAMONDS),
            card(Rank.SIX, Suit.CLUBS),
            card(Rank.FIVE, Suit.SPADES),
        ])
        trips = HandEvaluator.evaluate([
            card(Rank.ACE, Suit.SPADES),
            card(Rank.ACE, Suit.HEARTS),
            card(Rank.ACE, Suit.DIAMONDS),
            card(Rank.KING, Suit.CLUBS),
            card(Rank.TWO, Suit.SPADES),
        ])

        self.assertGreater(straight.score, trips.score)


class PotManagerTests(unittest.TestCase):
    def test_side_pots_are_sliced_by_bet_levels(self):
        pot = PotManager()
        pot.add_bet("a", 100)
        pot.add_bet("b", 200)
        pot.add_bet("c", 300)

        side_pots = pot.calculate_side_pots()

        self.assertEqual(
            [(p.amount, p.eligible_players) for p in side_pots],
            [
                (300, {"a", "b", "c"}),
                (200, {"b", "c"}),
                (100, {"c"}),
            ],
        )

    def test_distribute_awards_each_side_pot_to_eligible_best_hand(self):
        pot = PotManager()
        pot.add_bet("a", 100)
        pot.add_bet("b", 200)
        pot.add_bet("c", 300)

        winnings = pot.distribute({"a": 30, "b": 20, "c": 10})

        self.assertEqual(winnings, {"a": 300, "b": 200, "c": 100})

    def test_folded_player_cannot_win_pot(self):
        pot = PotManager()
        pot.add_bet("a", 100)
        pot.add_bet("b", 100)
        pot.mark_folded("a")

        winnings = pot.distribute({"a": 100, "b": 1})

        self.assertEqual(winnings, {"b": 200})


if __name__ == "__main__":
    unittest.main()
