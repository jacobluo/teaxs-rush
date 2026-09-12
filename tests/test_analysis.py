import random
import unittest
from engine.card import Card, Rank, Suit
from engine.evaluator import HandEvaluator
from engine.analysis import analyze_position, score_cards


def cards(text):
    suits = {'s':Suit.SPADES,'h':Suit.HEARTS,'d':Suit.DIAMONDS,'c':Suit.CLUBS}
    ranks = {'T':10,'J':11,'Q':12,'K':13,'A':14}
    return [Card(suits[x[-1]], Rank(ranks.get(x[:-1], int(x[:-1]) if x[:-1].isdigit() else 0))) for x in text.split()]


def position(hand, board, opponents=1):
    return {'hand':[c.to_dict() for c in cards(hand)], 'community_cards':[c.to_dict() for c in cards(board)],
            'opponents_count':opponents, 'my_chips':1000, 'my_bet':0, 'my_total_bet':0,
            'current_bet':0, 'pot':200, 'hero_id':'me', 'players':[]}


class AnalysisTests(unittest.TestCase):
    def test_fast_score_matches_game_evaluator_including_special_hands(self):
        deck = [Card(s, r) for s in Suit for r in Rank]
        rng = random.Random(8)
        hands = [cards(s) for s in ['As 2s 3s 4s 5s Kh Kd', 'As Ah Ac Ks Kh Kc 2d', 'As Ks Qs Js Ts 3h 2h', 'As Ah Ks Kh Qs Qh 2h']]
        hands += [rng.sample(deck, size) for size in (5,6,7) for _ in range(200)]
        for hand in hands:
            self.assertEqual(score_cards(hand), HandEvaluator.evaluate(hand).score, hand)

    def test_unbeatable_hand_wins_and_does_not_report_ties(self):
        result = analyze_position(position('Ts 2h', 'As Ks Qs Js 3d', 3), samples=100, seed=7)
        self.assertEqual(result['win_probability'], 1)
        self.assertEqual(result['tie_probability'], 0)
        self.assertEqual(result['equity'], 1)
        self.assertEqual(result['current_hand'], '皇家同花顺')
        self.assertIsNone(result['improvement_probability'])

    def test_board_royal_flush_splits_equally_among_all_remaining_players(self):
        result = analyze_position(position('2h 3d', 'As Ks Qs Js Ts', 3), samples=100, seed=7)
        self.assertEqual(result['win_probability'], 0)
        self.assertEqual(result['tie_probability'], 1)
        self.assertEqual(result['equity'], 0.25)

    def test_short_stack_call_excludes_unreachable_side_pot(self):
        context = position('As Ah', '', 2)
        context.update(my_chips=50, my_bet=50, my_total_bet=50, current_bet=300, pot=650,
                       players=[{'id':'me','total_bet':50},{'id':'a','total_bet':300},{'id':'b','total_bet':300}])
        result = analyze_position(context, samples=100, seed=7)
        self.assertEqual(result['call_cost'], 50)
        self.assertEqual(result['eligible_pot'], 300)
        self.assertAlmostEqual(result['pot_odds'], 1/6)
        self.assertTrue(result['has_side_pot'])

    def test_flush_draw_improvements_and_board_threats_are_described(self):
        result = analyze_position(position('As Ks', 'Qs 7s 2h'), samples=500, seed=7)
        self.assertGreater(result['improvement_probability'], .2)
        self.assertTrue(any(x['name'] == '同花' for x in result['improvements']))
        self.assertTrue(result['threats'])
        self.assertEqual(result['samples'], 500)
        self.assertLessEqual(result['win_interval'][0], result['win_probability'])
        self.assertGreaterEqual(result['win_interval'][1], result['win_probability'])
