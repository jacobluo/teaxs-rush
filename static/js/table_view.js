/** Responsive, accessible table. Uses the same state/event interface as the canvas view. */
const PokerTable = {
    root: null,
    state: null,
    _avatars: new Map(),
    _reasoningBubbles: {},
    _recentActions: new Map(),
    _latestAction: null,
    init(root) { this.root = root; this._render(); },
    updateState(state) {
        if (state.hand_number !== this.state?.hand_number || state.stage !== this.state?.stage || state.stage === 'waiting' || state.hand_result) this.clearActions();
        this.state = state;
        this._render();
    },
    clearActions() {
        for (const action of this._recentActions.values()) clearTimeout(action.timer);
        this._recentActions.clear();
        this._latestAction = null;
    },
    showAction(data) {
        if (!data.player?.id) return;
        const labels = {fold:'弃牌',check:'过牌',call:'跟注',raise:'加注至',all_in:'全押'};
        const street = this._street(data.stage || this.state?.stage);
        const label = (street ? `${street} · ` : '') + (labels[data.action] || '行动') + (data.amount > 0 ? ` ${this._money(data.amount)}` : '');
        const reminder = {id:data.player.id, name:data.player.name, type:data.action, label};
        const previous = this._recentActions.get(data.player.id);
        if (previous) clearTimeout(previous.timer);
        this._recentActions.set(data.player.id, reminder);
        this._latestAction = reminder;
        reminder.timer = setTimeout(() => {
            if (this._recentActions.get(data.player.id) !== reminder) return;
            this._recentActions.delete(data.player.id);
            if (this._latestAction === reminder) this._latestAction = null;
            this._render();
        }, 5000);
        if (this.state?.players) {
            this.state.players = this.state.players.map(p => p.id === data.player.id ? {...p, ...data.player} : p);
            this.state.thinking_player_id = null;
        }
        this._render();
    },
    showHandResult(result) {
        this.updateState({...this.state, stage:'hand_complete', hand_result:result, hand_number:result.hand_number,
            players:result.players || this.state?.players || [], thinking_player_id:null});
    },
    _result() {
        const result = this.state?.hand_result;
        if (!result || !['hand_complete','game_over','showdown'].includes(this.state.stage)) return '';
        const winners = result.winners || [];
        return `<section class="hand-result" role="status" aria-label="本手结算">
            <span class="result-kicker">第 ${this._money(result.hand_number)} 手 · 本手结算</span>
            <h2>${winners.length > 1 ? '多人赢得底池' : '本手赢家'}</h2>
            <div class="result-winners">${winners.map(w => `<div class="result-winner"><strong>${this._escape(w.player?.name)}</strong><b>赢得 ${this._money(w.amount)} <small>筹码</small></b><span>${this._escape(w.hand_rank || (result.all_folded ? '其他玩家弃牌' : '摊牌获胜'))}</span></div>`).join('')}</div>
            <p>${this.state.stage === 'game_over' ? '本场已结束，可点击「再来一局」' : this.state.is_paused ? '已暂停，继续后开始下一手' : '结算展示 5 秒后自动继续'}</p>
        </section>`;
    },
    setReasoning(id, text) { this._reasoningBubbles[id] = text; },
    clearPlayerBubble(id) { delete this._reasoningBubbles[id]; },
    clearReasoningBubbles() { this._reasoningBubbles = {}; },
    _escape(value) {
        return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    },
    _street(stage) { return {preflop:'翻前',flop:'翻牌',turn:'转牌',river:'河牌'}[stage] || ''; },
    _money(value) { return Number(value || 0).toLocaleString('zh-CN'); },
    _card(card, placeholder = false) {
        if (!card) return `<span class="playing-card ${placeholder ? 'card-slot' : 'card-back'}" aria-label="${placeholder ? '等待发牌' : '底牌未公开'}">${placeholder ? '·' : '♠'}</span>`;
        const red = ['♥', '♦'].includes(card.suit);
        return `<span class="playing-card ${red ? 'red' : ''}" aria-label="${this._escape(card.rank + card.suit)}"><b>${this._escape(card.rank)}</b><span>${this._escape(card.suit)}</span></span>`;
    },
    _avatar(style) {
        const avatarStyle = ['激进','保守','均衡','诈唬','诡计'].includes(style) ? style : '均衡';
        if (!this._avatars.has(avatarStyle)) {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 64;
            const ctx = canvas.getContext('2d');
            if (!ctx) return '';
            AvatarRenderer.drawAvatar(ctx, avatarStyle, 0, 0, 64);
            this._avatars.set(avatarStyle, canvas.toDataURL());
        }
        return `<img class="seat-avatar" src="${this._avatars.get(avatarStyle)}" alt="">`;
    },
    _seat(player, index, count) {
        const own = player.player_type === 'human';
        const thinking = player.id === this.state.thinking_player_id;
        const positions = {BTN:'BTN 庄家',SB:'SB 小盲',BB:'BB 大盲',UTG:'UTG 枪口位',HJ:'HJ 劫位',CO:'CO 截止位'};
        const codes = (this.state.seat_positions?.[player.id] || '').split('/').filter(Boolean);
        const tags = codes.map(code => `<span class="position-badge position-${this._escape(code.toLowerCase())}">${this._escape(positions[code] || `${code} 中位`)}</span>`);
        const first = this._street(this.state.stage) && player.id === this.state.first_actor_id;
        const actions = {fold:'已弃牌',check:'过牌',call:'跟注',raise:'加注',all_in:'全押'};
        const action = player.is_eliminated ? '已淘汰' : player.folded ? '已弃牌' : player.all_in ? '全押' : thinking ? (own ? '轮到你' : '正在行动…') : (actions[String(player.last_action || '').toLowerCase()] || '等待行动');
        const recent = this._recentActions.get(player.id);
        const winner = this.state.hand_result?.winners?.some(w => w.player?.id === player.id);
        const angle = 2 * Math.PI * index / count;
        const x = 50 - 38 * Math.sin(angle);
        const y = 50 + 36 * Math.cos(angle);
        return `<article class="seat ${own ? 'own-seat' : ''} ${thinking ? 'is-thinking' : ''} ${recent ? 'has-recent-action' : ''} ${winner ? 'is-winner' : ''} ${player.folded || player.is_eliminated ? 'is-folded' : ''}" data-player-id="${this._escape(player.id)}" style="--seat-x:${x}%;--seat-y:${y}%">
            <div class="seat-top">${this._avatar(own ? '均衡' : player.style)}<div class="seat-identity"><strong>${this._escape(player.name)}${own ? '<em>你</em>' : ''}</strong><span>${this._money(player.chips)} <small>筹码</small></span></div></div>
            <div class="seat-position">${tags.join('')}${first ? '<span class="first-actor-badge">① 本轮先行动</span>' : ''}${thinking ? '<span class="current-actor-badge">▶ 现在行动</span>' : ''}</div>
            <div class="seat-bottom"><div class="hole-cards">${this._card(player.hand?.[0])}${this._card(player.hand?.[1])}</div><div class="seat-action">${own ? '<small>你的手牌</small>' : ''}<span>${action}</span>${player.current_bet > 0 ? `<small>已下注 ${this._money(player.current_bet)}</small>` : ''}</div></div>
            ${recent ? `<div class="action-flash action-${this._escape(recent.type)}"><small>刚刚行动</small> ${this._escape(recent.label)}</div>` : winner ? '<div class="winner-badge">★ 本手赢家</div>' : ''}
        </article>`;
    },
    _render() {
        if (!this.root) return;
        const state = this.state || {};
        const previousScroll = this.root.querySelector?.('.seats')?.scrollLeft || 0;
        const previousActor = this._lastRenderedActor;
        this._lastRenderedActor = state.thinking_player_id;
        const players = [...(state.players || [])];
        // Anchor the human seat at the bottom, independently of dealer rotation.
        const humanIndex = players.findIndex(p => p.player_type === 'human');
        if (humanIndex > 0) players.unshift(...players.splice(humanIndex, 1));
        if (!players.length) {
            this.root.innerHTML = `<div class="empty-table"><div class="empty-cards">${this._card({rank:'A',suit:'♠'})}${this._card({rank:'K',suit:'♥'})}</div><span class="eyebrow">YOUR SEAT IS READY</span><h2>这一手，轮到你。</h2><p>读懂牌面，做出你的选择。<br>点击「入座练习」，开始你的第一手牌。</p><div class="table-rules"><span>01 发两张底牌</span><span>02 跟注或加注</span><span>03 比出最佳五张</span></div></div>`;
            return;
        }
        const stages = {waiting:'等待开局',preflop:'翻前',flop:'翻牌',turn:'转牌',river:'河牌',showdown:'摊牌',hand_complete:'本手结算',game_over:'本场结束'};
        const result = this._result();
        const board = `<section class="community-board" aria-label="公共牌与底池">${result || `<span class="eyebrow">${stages[state.stage] || '牌桌'}</span><div class="pot-label">底池 <strong>${this._money(state.pot)}</strong><small>筹码</small></div>`}<div class="community-cards">${Array.from({length:5}, (_, i) => this._card(state.community_cards?.[i], true)).join('')}</div><span class="board-caption">TEXAS RUSH · NO LIMIT HOLD’EM</span></section>`;
        const recent = this._latestAction;
        const activity = recent ? `<span>刚刚行动</span><strong>${this._escape(recent.name)}</strong><b>${this._escape(recent.label)}</b>` : `<span>牌桌动态</span> ${this._street(state.stage) ? `${this._street(state.stage)} · 等待玩家行动` : '玩家出手后，这里会显示动作提醒'}`;
        const scrollHint = players.length > 4 ? `<span class="seat-scroll-hint">${players.length} 人 · 滑动查看</span>` : '';
        const ticker = `<div class="action-ticker ${recent ? 'active' : ''}" role="status" aria-live="polite">${activity}${scrollHint}</div>`;
        const own = players.find(p => p.player_type === 'human');
        this.root.innerHTML = `${ticker}<div class="table-arena ${players.length > 6 ? 'many-seats' : ''}"><div class="table-felt" aria-hidden="true"></div><div class="seats">${players.map((p,i) => p === own ? '' : this._seat(p,i,players.length)).join('')}</div>${board}${own ? `<div class="hero-seat-slot">${this._seat(own,0,players.length)}</div>` : ''}</div>`;
        const strip = this.root.querySelector?.('.seats');
        if (!strip) return;
        strip.scrollLeft = previousScroll;
        if (strip.scrollWidth <= strip.clientWidth || previousActor === state.thinking_player_id) return;
        const actor = [...strip.children].find(seat => seat.dataset.playerId === state.thinking_player_id);
        if (!actor) return;
        const viewport = strip.getBoundingClientRect();
        const seat = actor.getBoundingClientRect();
        if (seat.left < viewport.left) strip.scrollLeft -= viewport.left - seat.left;
        else if (seat.right > viewport.right) strip.scrollLeft += seat.right - viewport.right;
    },
};
