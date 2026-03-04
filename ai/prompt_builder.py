"""Prompt 构建器：将游戏状态序列化为 LLM 可理解的结构化文本"""

from typing import Dict, List, Any


class PromptBuilder:
    """构建 LLM 决策所需的 prompt"""

    @staticmethod
    def build(game_state: dict) -> str:
        """将游戏状态序列化为 LLM user prompt"""
        hand = game_state.get("hand", [])
        community = game_state.get("community_cards", [])
        pot = game_state.get("pot", 0)
        current_bet = game_state.get("current_bet", 0)
        my_chips = game_state.get("my_chips", 0)
        my_bet = game_state.get("my_bet", 0)
        players = game_state.get("players", [])
        position = game_state.get("position", "")
        stage = game_state.get("stage", "")
        min_raise = game_state.get("min_raise", 0)
        big_blind = game_state.get("big_blind", 100)
        available = game_state.get("available_actions", {})
        hand_number = game_state.get("hand_number", 0)

        # 格式化手牌
        hand_str = ", ".join(
            f"{c['rank']}{c['suit']}" for c in hand
        ) if hand else "无"

        # 格式化公共牌
        community_str = ", ".join(
            f"{c['rank']}{c['suit']}" for c in community
        ) if community else "无（翻牌前）"

        # 格式化玩家信息
        players_str = ""
        for i, p in enumerate(players):
            status = ""
            if p.get("folded"):
                status = "[已弃牌]"
            elif p.get("all_in"):
                status = "[全押]"
            last_action = p.get("last_action", "")
            players_str += (
                f"  - {p['name']}: 筹码=${p['chips']}, "
                f"本轮下注=${p.get('current_bet', 0)} "
                f"{status}"
                f"{' 上一动作: ' + last_action if last_action else ''}\n"
            )

        # 格式化可用动作
        actions_str = "你可以执行以下动作：\n"
        if available.get("can_check"):
            actions_str += "  - check（过牌）\n"
        if available.get("can_call"):
            actions_str += f"  - call（跟注 ${available.get('to_call', 0)}）\n"
        if available.get("can_raise"):
            actions_str += (
                f"  - raise（加注，最低加注到 ${available.get('min_raise_to', 0)}，"
                f"最高到 ${available.get('max_raise_to', 0)}）\n"
            )
        if available.get("can_fold"):
            actions_str += "  - fold（弃牌）\n"
        if available.get("can_all_in"):
            actions_str += f"  - all_in（全押 ${my_chips}）\n"

        prompt = f"""=== 第 {hand_number} 手牌 · {stage.upper()} 阶段 ===

【你的手牌】{hand_str}
【公共牌】{community_str}
【你的位置】{position}

【底池】${pot}
【当前最高下注】${current_bet}
【你本轮已下注】${my_bet}
【你的筹码】${my_chips}
【大盲注】${big_blind}

【牌桌玩家】
{players_str}
{actions_str}
请根据以上信息做出决策。你必须返回一个JSON对象，格式如下：
{{"action": "fold/check/call/raise/all_in", "amount": 加注金额(仅raise时需要,为加注到的总金额), "reasoning": "你的思考过程(简短)"}}

注意：
1. action 只能是 fold, check, call, raise, all_in 之一
2. raise 时 amount 是加注到的总金额，不是增量
3. reasoning 请简短说明决策理由
4. 只返回JSON，不要有其他内容"""

        return prompt

    @staticmethod
    def build_hand_summary(hand_result: dict, player_name: str) -> str:
        """将一手牌的结果构建为 AI 记忆摘要"""
        hand_number = hand_result.get("hand_number", "?")
        all_folded = hand_result.get("all_folded", False)

        summary_parts = [f"第{hand_number}手牌结果："]

        if all_folded:
            winners = hand_result.get("winners", [])
            if winners:
                w = winners[0]
                winner_name = w["player"]["name"]
                amount = w["amount"]
                summary_parts.append(f"{winner_name}赢得${amount}（其他人全部弃牌）")
        else:
            winners = hand_result.get("winners", [])
            showdown = hand_result.get("showdown", [])

            for w in winners:
                winner_name = w["player"]["name"]
                amount = w["amount"]
                hand_rank = w.get("hand_rank", "")
                summary_parts.append(f"{winner_name}赢得${amount}（{hand_rank}）")

            # 添加摊牌信息
            if showdown:
                showdown_info = []
                for s in showdown:
                    pname = s["player"]["name"]
                    rank = s["hand_rank"]
                    showdown_info.append(f"{pname}:{rank}")
                summary_parts.append("摊牌: " + ", ".join(showdown_info))

        # 加入各玩家当前筹码
        players = hand_result.get("players", [])
        chips_info = []
        for p in players:
            if not p.get("is_eliminated"):
                chips_info.append(f"{p['name']}=${p['chips']}")
        if chips_info:
            summary_parts.append("筹码: " + ", ".join(chips_info))

        return " | ".join(summary_parts)
