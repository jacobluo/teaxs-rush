"""Equity estimates from visible cards only; no access to the live deck or opponents' hands."""
from collections import Counter
import math
import random

from engine.card import Card, Rank, Suit
from engine.evaluator import HandEvaluator, HandRank


def _straight(ranks):
    ranks = set(ranks)
    if 14 in ranks:
        ranks.add(1)
    for high in range(14, 4, -1):
        if all(rank in ranks for rank in range(high - 4, high + 1)):
            return high
    return 0


def score_cards(cards):
    """Rank 5–7 cards directly, with the same ordering as HandEvaluator."""
    counts = Counter(c.rank.value for c in cards)
    suits = {}
    for card in cards:
        suits.setdefault(card.suit, []).append(card.rank.value)
    flush = next((sorted(ranks, reverse=True) for ranks in suits.values() if len(ranks) >= 5), None)
    make = HandEvaluator._make_score
    if flush:
        high = _straight(flush)
        if high:
            return make(HandRank.ROYAL_FLUSH if high == 14 else HandRank.STRAIGHT_FLUSH, [high])
    ranks = sorted(counts, reverse=True)
    fours = [r for r in ranks if counts[r] == 4]
    if fours:
        return make(HandRank.FOUR_OF_A_KIND, [fours[0], next(r for r in ranks if r != fours[0])])
    trips = [r for r in ranks if counts[r] >= 3]
    if trips:
        pairs = [r for r in ranks if r != trips[0] and counts[r] >= 2]
        if pairs:
            return make(HandRank.FULL_HOUSE, [trips[0], pairs[0]])
    if flush:
        return make(HandRank.FLUSH, flush[:5])
    high = _straight(ranks)
    if high:
        return make(HandRank.STRAIGHT, [high])
    if trips:
        return make(HandRank.THREE_OF_A_KIND, [trips[0]] + [r for r in ranks if r != trips[0]][:2])
    pairs = [r for r in ranks if counts[r] >= 2]
    if len(pairs) >= 2:
        return make(HandRank.TWO_PAIR, pairs[:2] + [next(r for r in ranks if r not in pairs[:2])])
    if pairs:
        return make(HandRank.ONE_PAIR, pairs[:1] + [r for r in ranks if r != pairs[0]][:3])
    return make(HandRank.HIGH_CARD, ranks[:5])


def _cards(values):
    suits = {s.symbol(): s for s in Suit}
    ranks = {r.symbol(): r for r in Rank}
    return [Card(suits[c['suit']], ranks[c['rank']]) for c in values]


def _threats(board):
    if not board:
        return ['公共牌尚未发出，翻牌后重新评估牌面。']
    threats = []
    suit_count = max(Counter(c.suit for c in board).values())
    if suit_count >= 3:
        threats.append('公共牌有至少三张同花，对手可能组成同花。')
    elif suit_count == 2 and len(board) < 5:
        threats.append('公共牌有两张同花，后续同花牌可能改变牌力。')
    if max(Counter(c.rank for c in board).values()) >= 2:
        threats.append('公共牌成对，需要留意三条、葫芦或四条。')
    ranks = {c.rank.value for c in board}
    if 14 in ranks:
        ranks.add(1)
    if any(len(ranks.intersection(range(low, low + 5))) >= 3 for low in range(1, 11)):
        threats.append('公共牌较连张，对手可能有顺子或顺子听牌。')
    return threats or ['公共牌暂未出现明显的同花、连张或对子结构。']


def analyze_position(context, samples=2000, seed=None):
    hand = _cards(context['hand'])
    board = _cards(context['community_cards'])
    known = hand + board
    opponents = context['opponents_count']
    if len(hand) != 2 or len(board) not in (0, 3, 4, 5) or len(set(known)) != len(known) or not 1 <= opponents <= 8:
        raise ValueError('当前牌局无法分析')
    remaining = [Card(s, r) for s in Suit for r in Rank if Card(s, r) not in known]
    rng = random.Random(seed)
    missing = 5 - len(board)
    wins = ties = 0
    shares = 0.0
    final_ranks = Counter()
    for _ in range(samples):
        draw = rng.sample(remaining, missing + opponents * 2)
        runout = board + draw[:missing]
        hero_score = score_cards(hand + runout)
        final_ranks[hero_score // HandEvaluator.RANK_BASE] += 1
        other_scores = [score_cards(draw[missing + i * 2:missing + i * 2 + 2] + runout) for i in range(opponents)]
        best_other = max(other_scores)
        if hero_score > best_other:
            wins += 1
            shares += 1
        elif hero_score == best_other:
            ties += 1
            shares += 1 / (1 + other_scores.count(hero_score))
    if board:
        current = HandEvaluator.evaluate(known)
        current_name, current_rank = current.description, current.rank.value
    else:
        pair = hand[0].rank == hand[1].rank
        current_name = f'口袋对子 {hand[0].rank.symbol()}' if pair else f'{hand[0].rank.symbol()}{hand[1].rank.symbol()} · ' + ('同花手牌' if hand[0].suit == hand[1].suit else '不同花手牌')
        current_rank = HandRank.ONE_PAIR.value if pair else HandRank.HIGH_CARD.value
    improvements = [{'name':HandRank(rank).name_cn(), 'probability':count / samples}
                    for rank, count in final_ranks.most_common() if rank > current_rank] if missing else []
    call = min(context['my_chips'], max(0, context['current_bet'] - context['my_bet']))
    cap = context['my_total_bet'] + call
    contributions = context.get('players', [])
    eligible_pot = sum(min(p['total_bet'], cap) for p in contributions) + call if contributions else context['pot'] + call
    side_pot = any(p['total_bet'] > cap for p in contributions)
    p = wins / samples
    z = 1.96
    center = (p + z*z/(2*samples)) / (1 + z*z/samples)
    half = z * math.sqrt(p*(1-p)/samples + z*z/(4*samples*samples)) / (1 + z*z/samples)
    return {
        'win_probability':p, 'tie_probability':ties/samples, 'equity':shares/samples,
        'win_interval':[max(0, center-half), min(1, center+half)], 'samples':samples,
        'opponents':opponents, 'current_hand':current_name,
        'improvement_probability':sum(x['probability'] for x in improvements) if missing else None,
        'improvements':improvements[:4], 'threats':_threats(board),
        'call_cost':call, 'eligible_pot':eligible_pot,
        'pot_odds':call/eligible_pot if eligible_pot else 0, 'has_side_pot':side_pot,
        'assumptions':'对手未知手牌按随机组合抽样，假设所有在局玩家摊牌；不计后续下注与弃牌。权益包含平局分成，有边池时不代表实际筹码收益。',
    }
