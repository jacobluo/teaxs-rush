/** Responsive, accessible table. Uses the same state/event interface as the canvas view. */
const PokerTable = {
    root: null,
    state: null,
    _reasoningBubbles: {},
    _avatars: new Map(),
    init(root) { this.root = root; this._render(); },
    updateState(state) { this.state = state; this._render(); },
    setReasoning(id, text) { this._reasoningBubbles[id] = text; },
    clearPlayerBubble(id) { delete this._reasoningBubbles[id]; },
    clearReasoningBubbles() { this._reasoningBubbles = {}; },
    _escape(value) {
        return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    },
    _money(value) { return Number(value || 0).toLocaleString('zh-CN'); },
    _card(card, placeholder = false) {
        if (!card) return `<span class="playing-card ${placeholder ? 'card-slot' : 'card-back'}" aria-label="${placeholder ? '等待发牌' : '底牌未公开'}">${placeholder ? '·' : '♠'}</span>`;
        const red = ['♥', '♦'].includes(card.suit);
        return `<span class="playing-card ${red ? 'red' : ''}" aria-label="${this._escape(card.rank + card.suit)}"><b>${this._escape(card.rank)}</b><span>${this._escape(card.suit)}</span></span>`;
    },
    _avatar(style) {
        if (!this._avatars.has(style)) {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 64;
            const ctx = canvas.getContext('2d');
            if (!ctx) return '';
            AvatarRenderer.drawAvatar(ctx, style || '均衡', 0, 0, 64);
            this._avatars.set(style, canvas.toDataURL());
        }
        return `<img class="seat-avatar" src="${this._avatars.get(style)}" alt="">`;
    },
    _seat(player, index, count) {
        const own = player.player_type === 'human';
        const thinking = player.id === this.state.thinking_player_id;
        const active = (this.state.players || []).filter(p => !p.is_eliminated);
        const activeIndex = active.findIndex(p => p.id === player.id);
        const tags = [];
        if (activeIndex >= 0) {
            if (activeIndex === this.state.dealer_index) tags.push('D 庄家');
            if (activeIndex === this.state.sb_index) tags.push('SB');
            if (activeIndex === this.state.bb_index) tags.push('BB');
        }
        const actions = {fold:'已弃牌',check:'过牌',call:'跟注',raise:'加注',all_in:'全押'};
        const action = player.is_eliminated ? '已淘汰' : player.folded ? '已弃牌' : player.all_in ? '全押' : thinking ? (own ? '轮到你' : '思考中…') : (actions[String(player.last_action || '').toLowerCase()] || '等待行动');
        const angle = 2 * Math.PI * index / count;
        const x = 50 - 38 * Math.sin(angle);
        const y = 50 + 36 * Math.cos(angle);
        return `<article class="seat ${own ? 'own-seat' : ''} ${thinking ? 'is-thinking' : ''} ${player.folded || player.is_eliminated ? 'is-folded' : ''}" style="--seat-x:${x}%;--seat-y:${y}%">
            <div class="seat-top">${this._avatar(player.style)}<div class="seat-identity"><strong>${this._escape(player.name)}${own ? '<em>你</em>' : ''}</strong><span>${this._money(player.chips)} <small>筹码</small></span></div><span class="seat-position">${tags.join(' · ')}</span></div>
            <div class="seat-bottom"><div class="hole-cards">${this._card(player.hand?.[0])}${this._card(player.hand?.[1])}</div><div class="seat-action">${own ? '<small>你的手牌</small>' : ''}<span>${action}</span>${player.current_bet > 0 ? `<small>已下注 ${this._money(player.current_bet)}</small>` : ''}</div></div>
        </article>`;
    },
    _render() {
        if (!this.root) return;
        const state = this.state || {};
        const players = [...(state.players || [])];
        // Anchor the human seat at the bottom, independently of dealer rotation.
        const humanIndex = players.findIndex(p => p.player_type === 'human');
        if (humanIndex > 0) players.unshift(...players.splice(humanIndex, 1));
        if (!players.length) {
            this.root.innerHTML = `<div class="empty-table"><div class="empty-cards">${this._card({rank:'A',suit:'♠'})}${this._card({rank:'K',suit:'♥'})}</div><span class="eyebrow">YOUR SEAT IS READY</span><h2>这一手，轮到你。</h2><p>读懂牌面，做出你的选择。<br>点击「入座练习」，开始你的第一手牌。</p><div class="table-rules"><span>01 发两张底牌</span><span>02 跟注或加注</span><span>03 比出最佳五张</span></div></div>`;
            return;
        }
        const stages = {waiting:'等待开局',preflop:'翻前',flop:'翻牌',turn:'转牌',river:'河牌',showdown:'摊牌',hand_complete:'本手结算',game_over:'本场结束'};
        const board = `<section class="community-board" aria-label="公共牌与底池"><span class="eyebrow">${stages[state.stage] || '牌桌'}</span><div class="pot-label">底池 <strong>${this._money(state.pot)}</strong><small>筹码</small></div><div class="community-cards">${Array.from({length:5}, (_, i) => this._card(state.community_cards?.[i], true)).join('')}</div><span class="board-caption">TEXAS RUSH · NO LIMIT HOLD’EM</span></section>`;
        this.root.innerHTML = `<div class="table-felt" aria-hidden="true"></div><div class="seats">${players.map((p,i) => this._seat(p,i,players.length)).join('')}</div>${board}`;
    },
};
