/** Private, read-only poker analysis. Every asynchronous result belongs to one position. */
const PokerAdvisor = {
    key:null, revision:0, stats:null, advice:null, open:false, connected:true,
    loadingAdvice:false, statsError:'', adviceError:'', timer:null, statsRequest:null, adviceRequest:null,
    init() {
        const host = this._el('analysisDrawer');
        const details = this._el('analysisDetails');
        if (host && details && details.parentElement !== host) host.appendChild(details);
    },
    _el(id) { return document.getElementById(id); },
    _escape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },
    _pct(value) { return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'; },
    invalidate() {
        this.revision++;
        this.key = null;
        this.stats = this.advice = null;
        this.statsError = this.adviceError = '';
        this.loadingAdvice = false;
        clearTimeout(this.timer);
        this.statsRequest?.abort();
        this.adviceRequest?.abort();
        this._paint();
    },
    setConnected(connected) {
        this.connected = connected;
        if (!connected) this.invalidate();
    },
    update(state) {
        const root = this._el('pokerAdvisor');
        if (!root) return;
        const hero = state?.players?.find(p => p.player_type === 'human');
        const eligible = isAdmin() && state?.is_running && ['preflop','flop','turn','river'].includes(state.stage)
            && hero?.hand?.length === 2 && !hero.folded && !hero.is_eliminated
            && state.players.some(p => p.id !== hero.id && !p.folded && !p.is_eliminated);
        root.hidden = !eligible;
        if (!eligible) { this.open = false; this.invalidate(); return; }
        if (!this.connected) return;
        const key = JSON.stringify([state.hand_number,state.stage,state.community_cards,state.pot,hero.id,hero.hand,state.pending_human_action?.request_id,
            state.players.map(p => [p.id,p.chips,p.current_bet,p.total_bet,p.folded,p.all_in,p.is_eliminated,p.last_action])]);
        if (key === this.key) return;
        this.invalidate();
        this.key = key;
        const version = this.revision;
        this.timer = setTimeout(() => this._loadStats(version),150);
    },
    async _loadStats(version) {
        if (version !== this.revision) return;
        this.statsRequest = new AbortController();
        try {
            const res = await authFetch('/api/game/analysis',{signal:this.statsRequest.signal,cache:'no-store'});
            const data = await res.json();
            if (version !== this.revision) return;
            if (!res.ok) throw new Error(data.detail || '暂时无法计算，请重试');
            this.stats = data;
            this.statsError = '';
        } catch (error) {
            if (version !== this.revision || error.name === 'AbortError') return;
            this.statsError = error.message || '连接失败，请重试';
        }
        if (version === this.revision) this._paint();
    },
    toggle() {
        if (typeof updateDrawerPosition === 'function') updateDrawerPosition();
        this._el('tableSidePanel').dataset.open = 'false';
        this.open = !this.open;
        this._paint();
        if (this.open && this.stats?.is_turn && !this.advice) this.requestAdvice();
    },
    async requestAdvice() {
        if (!this.stats?.is_turn || this.loadingAdvice || this.advice || !this.connected) return;
        const version = this.revision;
        const positionId = this.stats.position_id;
        this.open = true;
        this.loadingAdvice = true;
        this.adviceError = '';
        this.adviceRequest = new AbortController();
        this._paint();
        try {
            const res = await authFetch('/api/game/advice',{method:'POST',signal:this.adviceRequest.signal,
                headers:{'Content-Type':'application/json'},body:JSON.stringify({position_id:positionId})});
            const data = await res.json();
            if (version !== this.revision || this.stats?.position_id !== positionId) return;
            if (!res.ok) throw new Error(data.detail || 'AI 暂时不可用，请重试');
            if (data.position_id !== positionId) throw new Error('牌局已变化，请获取最新建议');
            this.advice = data;
        } catch (error) {
            if (version !== this.revision || error.name === 'AbortError') return;
            this.adviceError = error.message || 'AI 连接失败，请重试';
        } finally {
            if (version === this.revision) { this.loadingAdvice = false; this._paint(); }
        }
    },
    retryStats() {
        this.statsError = '';
        this._paint();
        return this._loadStats(this.revision);
    },
    _paint() {
        if (!this._el('pokerAdvisor')) return;
        const s = this.stats;
        this._el('analysisMetrics').innerHTML = s
            ? `<span>胜率 <strong>≈ ${this._pct(s.win_probability)}</strong></span>`
            : `<span>${this._escape(!this.connected ? '连接中断，分析已失效' : this.statsError || '胜率计算中…')}</span>`;
        this._el('analysisToggle').textContent = this.open ? '收起分析' : 'AI 分析';
        this._el('analysisToggle').setAttribute('aria-expanded',String(this.open));
        this._el('analysisDetails').hidden = !this.open;
        this._el('analysisRetry').hidden = !this.statsError;
        this._el('analysisAsk').disabled = !s?.is_turn || this.loadingAdvice || !!this.advice || !this.connected;
        this._el('analysisAsk').textContent = this.loadingAdvice ? '正在分析…' : this.advice ? '本轮建议已生成' : this.adviceError ? '重试 AI 分析' : '获取本轮 AI 建议';
        this._el('analysisNumbers').innerHTML = s ? `
            <div><span>纯获胜 / 平局</span><strong>${this._pct(s.win_probability)} / ${this._pct(s.tie_probability)}</strong></div>
            <div><span>摊牌权益（含平局分成）</span><strong>${this._pct(s.equity)}</strong></div>
            <div><span>当前最佳牌型</span><strong>${this._escape(s.current_hand)}</strong></div>
            <div><span>跟注成本 / 可争夺底池</span><strong>${s.call_cost.toLocaleString()} / ${s.eligible_pot.toLocaleString()} · ${this._pct(s.pot_odds)}</strong></div>
            <div><span>到河牌的牌型提升概率</span><strong>${s.improvement_probability === null ? '已到河牌' : this._pct(s.improvement_probability)}</strong></div>
            <div><span>可能改善为</span><strong>${s.improvements.map(x => `${this._escape(x.name)} ${this._pct(x.probability)}`).join(' · ') || '暂无更高牌型'}</strong></div>` : '';
        this._el('analysisThreats').textContent = s ? s.threats.join(' ') : '';
        this._el('analysisAssumptions').textContent = s ? `${s.samples.toLocaleString()} 次模拟 · ${s.opponents} 位在局对手 · 胜率 95% 区间 ${s.win_interval.map(x=>this._pct(x)).join('–')}。${s.assumptions} 牌型提升只比较牌型等级，不保证获胜。${s.has_side_pot ? '当前存在超出你跟注后筹码上限的底池，请结合边池判断。' : ''}` : '';
        const labels = {check:'过牌',call:'跟注',raise:'加注至',fold:'弃牌',all_in:'全押'};
        this._el('analysisAdvice').textContent = this.advice
            ? `建议${labels[this.advice.action] || '等待'}${this.advice.amount > 0 ? ` ${this.advice.amount.toLocaleString()} 筹码` : ''}。${this.advice.reasoning}`
            : this.loadingAdvice ? 'AI 正在结合数据分析，你仍可正常出牌。' : this.adviceError || (s?.is_turn ? '点击获取本轮建议，由你决定如何出牌。' : '轮到你时可获取 AI 建议；牌局变化后旧建议会清除。');
    },
};
