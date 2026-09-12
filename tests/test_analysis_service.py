import asyncio
from copy import deepcopy
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
from game.controller import GameController, GameStage
from game.player import Player
from game.betting import BettingRound
from server.analysis_service import AnalysisService
from test_analysis import cards


class AnalysisServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        hero = Player('me','我',player_type='human')
        hero.hand = cards('As Kh')
        bot = Player('bot','对手')
        bot.hand = cards('Qs Qh')
        controller = GameController([hero,bot])
        controller.stage = GameStage.PREFLOP
        controller.is_running = True
        controller.current_betting = BettingRound(controller.players,0,100)
        self.manager = SimpleNamespace(controller=controller,_pending_human_action={'request_id':'turn-1','player_id':'me'})
        self.store = SimpleNamespace(get_by_id=AsyncMock(return_value=None),list_all=AsyncMock(return_value=[]))
        self.service = AnalysisService(self.manager,self.store)

    async def test_context_and_statistics_ignore_opponent_cards_and_deck(self):
        key, before = self.service.snapshot()
        self.assertNotIn('hand', before['players'][1])
        self.manager.controller.players[1].hand = cards('2c 3c')
        self.manager.controller.deck.reset()
        self.assertEqual(self.service.snapshot(),(key,before))
        with patch('server.analysis_service.analyze_position',return_value={'win_probability':.5}) as calculate:
            one,two = await asyncio.gather(self.service.statistics(), self.service.statistics())
            self.assertEqual(one,two)
            self.assertEqual(calculate.call_count,1)

    async def test_changed_position_discards_a_finished_calculation(self):
        def change(*args,**kwargs):
            self.manager.controller.players[1].current_bet = 200
            return {'win_probability':.5}
        with patch('server.analysis_service.analyze_position',side_effect=change):
            with self.assertRaises(HTTPException) as raised:
                await self.service.statistics()
        self.assertEqual(raised.exception.status_code,409)

    async def test_advice_rejects_old_position_and_missing_model(self):
        with self.assertRaises(HTTPException) as raised:
            await self.service.advice('old-position')
        self.assertEqual(raised.exception.status_code,409)
        with patch('server.analysis_service.analyze_position',return_value={}):
            key,_ = self.service.snapshot()
            with self.assertRaises(HTTPException) as raised:
                await self.service.advice(key)
        self.assertEqual(raised.exception.status_code,503)

    async def test_advice_uses_only_visible_context_and_is_cached(self):
        self.store.get_by_id.return_value = SimpleNamespace(api_key='test-key',base_url='https://api.deepseek.com',model_name='deepseek-v4-pro')
        with patch('server.analysis_service.analyze_position',return_value={}), patch.object(self.service,'_ask_model',new=AsyncMock(return_value={'action':'check','amount':0,'reasoning':'可免费过牌'})) as ask:
            key,context = self.service.snapshot()
            results = await asyncio.gather(self.service.advice(key),self.service.advice(key))
            self.assertEqual(results[0],results[1])
            self.assertEqual(ask.await_count,1)
            self.assertEqual(ask.call_args.args[1],context)
            self.assertEqual(results[0]['action'],'check')
        self.assertEqual(self.manager.controller.players[0].chips,10000)

    async def test_folded_human_and_spectator_tables_cannot_analyze(self):
        self.manager.controller.players[0].folded = True
        with self.assertRaises(HTTPException):
            self.service.snapshot()

    async def test_advice_finishing_after_an_action_is_discarded(self):
        self.store.get_by_id.return_value = SimpleNamespace(api_key='test-key',base_url='https://api.deepseek.com',model_name='deepseek-v4-pro')
        async def late(*args):
            self.manager.controller.players[1].current_bet = 300
            return {'action':'check','amount':0,'reasoning':'old advice'}
        key,_=self.service.snapshot()
        with patch('server.analysis_service.analyze_position',return_value={}), patch.object(self.service,'_ask_model',side_effect=late):
            with self.assertRaises(HTTPException) as raised:
                await self.service.advice(key)
        self.assertEqual(raised.exception.status_code,409)
        self.assertNotIn(key,self.service._advice_cache)
