/**
 * 对战日志模块：CRT 终端风格
 */

const GameLogger = {
    container: null,
    maxEntries: 500,

    init() {
        this.container = document.getElementById('logContainer');
    },

    addLog(event) {
        if (!this.container) this.init();

        const type = event.type || 'system';
        const data = event.data || {};
        const timestamp = event.timestamp
            ? new Date(event.timestamp).toLocaleTimeString('zh-CN', { hour12: false })
            : new Date().toLocaleTimeString('zh-CN', { hour12: false });

        let text = '';
        let cssClass = 'system';

        switch (type) {
            case 'hand_start':
                text = `═══ 第 ${data.hand_number} 手 ═══ 庄家: ${data.dealer?.name || '?'} | 盲注: $${data.small_blind}/$${data.big_blind}`;
                cssClass = 'system';
                break;

            case 'blind_post':
                text = `${data.player?.name} 下${data.type === 'small_blind' ? '小盲' : '大盲'} $${data.amount}`;
                cssClass = 'action';
                break;

            case 'deal_hole_cards':
                text = `已发牌给 ${data.players?.length || 0} 位玩家`;
                cssClass = 'system';
                break;

            case 'community_cards':
                const stageMap = { 'flop': '翻牌', 'turn': '转牌', 'river': '河牌' };
                const cards = (data.cards || []).map(c => `${c.rank}${c.suit}`).join(' ');
                const stageName = stageMap[data.stage] || data.stage?.toUpperCase();
                text = `${stageName}: ${cards}`;
                cssClass = 'system';
                break;

            case 'player_action': {
                const actionMap = {
                    'fold': '弃牌', 'check': '过牌', 'call': '跟注',
                    'raise': '加注', 'all_in': '全押', 'bet': '下注',
                };
                const actionCN = actionMap[data.action] || data.action?.toUpperCase();
                const actionText = data.amount > 0
                    ? `${actionCN} $${data.amount}`
                    : actionCN;
                text = `${data.player?.name} → ${actionText} (底池: $${data.pot})`;
                cssClass = data.action === 'fold' ? 'fold' : 'action';

                // 显示思考过程
                if (data.reasoning) {
                    this._addEntry(timestamp, text, cssClass);
                    text = `  💭 ${data.reasoning}`;
                    cssClass = 'thinking';
                }
                break;
            }

            case 'hand_complete':
                if (data.winners) {
                    data.winners.forEach(w => {
                        const winText = `🏆 ${w.player?.name} 赢得 $${w.amount} ${w.hand_rank ? '(' + w.hand_rank + ')' : ''}`;
                        this._addEntry(timestamp, winText, 'win');
                    });
                }
                return;

            case 'player_eliminated':
                text = `☠ ${data.player?.name} 已被淘汰`;
                cssClass = 'error';
                break;

            case 'blind_increase':
                text = `⬆ 盲注上涨: $${data.small_blind}/$${data.big_blind}`;
                cssClass = 'win';
                break;

            case 'game_start':
                text = `▶ 游戏开始，共 ${data.players?.length || 0} 位玩家`;
                cssClass = 'system';
                break;

            case 'game_over':
                text = `■ 游戏结束，共进行 ${data.hand_number} 手`;
                cssClass = 'win';
                break;

            case 'game_configured':
                text = `⚙ 游戏已配置: ${data.players?.length || 0} 位玩家`;
                cssClass = 'system';
                break;

            case 'game_paused':
                text = '⏸ 游戏已暂停';
                cssClass = 'system';
                break;

            case 'game_resumed':
                text = '▶ 游戏已恢复';
                cssClass = 'system';
                break;

            case 'game_reset':
                text = '↺ 游戏已重置';
                cssClass = 'system';
                break;

            default:
                text = `[${type}] ${JSON.stringify(data).slice(0, 100)}`;
                cssClass = 'system';
        }

        if (text) {
            this._addEntry(timestamp, text, cssClass);
        }
    },

    _addEntry(timestamp, text, cssClass) {
        if (!this.container) this.init();

        const entry = document.createElement('div');
        entry.className = `log-entry ${cssClass}`;
        entry.innerHTML = `<span class="timestamp">[${timestamp}]</span>${this._escapeHtml(text)}`;
        this.container.appendChild(entry);

        // 限制条目数量
        while (this.container.children.length > this.maxEntries) {
            this.container.removeChild(this.container.firstChild);
        }

        // 自动滚动到底部
        this.container.scrollTop = this.container.scrollHeight;
    },

    addSystem(text) {
        const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        this._addEntry(timestamp, `[系统] ${text}`, 'system');
    },

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
};
