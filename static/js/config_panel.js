/**
 * AI 配置面板（管理员专属）
 */

const STYLE_OPTIONS = [
    { name: '激进', color: '#E06060' },
    { name: '保守', color: '#60C0A0' },
    { name: '均衡', color: '#87CEEB' },
    { name: '诈唬', color: '#D4A854' },
    { name: '诡计', color: '#B0D4F1' },
];

const ConfigPanel = {
    players: [],
    playerCount: 0,

    init() {
        // 默认添加 3 个玩家
        this.players = [];
        this.playerCount = 0;
        for (let i = 0; i < 3; i++) {
            this.addPlayer();
        }
    },

    async loadSavedConfig() {
        /**
         * 从后端加载上次保存的配置，恢复玩家信息和游戏参数。
         * 需在 ModelPanel.loadModels() 之后调用，以确保模型列表已就绪。
         */
        try {
            const res = await authFetch('/api/game/saved-config');
            if (!res.ok) return;
            const result = await res.json();
            if (result.status !== 'ok' || !result.config) return;

            const config = result.config;

            // 恢复玩家列表
            if (config.players && config.players.length >= 2) {
                this.players = [];
                this.playerCount = 0;
                config.players.forEach(p => {
                    this.playerCount++;
                    this.players.push({
                        id: `p${this.playerCount}`,
                        name: p.name || `AI-${this.playerCount}`,
                        style: p.style || '均衡',
                        model_id: p.model_id || '',
                    });
                });
                this.render();
            }

            // 恢复游戏参数
            const setVal = (id, val) => {
                const el = document.getElementById(id);
                if (el && val !== undefined) el.value = val;
            };
            const setChecked = (id, val) => {
                const el = document.getElementById(id);
                if (el && val !== undefined) el.checked = val;
            };
            setVal('settingBigBlind', config.big_blind);
            setVal('settingChips', config.starting_chips);
            setVal('settingMaxHands', config.max_hands);
            setVal('settingDelay', config.action_delay);
            setChecked('settingEliminate', config.eliminate_on_zero);
            setVal('settingBlindInc', config.blind_increase_interval);

            GameLogger.addSystem('已加载上次保存的游戏配置');
        } catch (e) {
            // 加载失败不影响正常使用
        }
    },

    addPlayer() {
        if (this.players.length >= 9) {
            alert('最多 9 位玩家');
            return;
        }

        this.playerCount++;
        const id = `p${this.playerCount}`;
        this.players.push({
            id,
            name: `AI-${this.playerCount}`,
            style: '均衡',
            model_id: '',
        });

        this.render();
    },

    removePlayer(id) {
        if (this.players.length <= 2) {
            alert('至少需要 2 位玩家');
            return;
        }
        this.players = this.players.filter(p => p.id !== id);
        this.render();
    },

    render() {
        const container = document.getElementById('playerCards');
        if (!container) return;

        const models = ModelPanel.models || [];

        container.innerHTML = this.players.map((p, i) => {
            const styleOptions = STYLE_OPTIONS.map(s =>
                `<option value="${s.name}" ${p.style === s.name ? 'selected' : ''}>${s.name}</option>`
            ).join('');

            const modelOptions = models.map(m =>
                `<option value="${m.id}" ${p.model_id === m.id ? 'selected' : ''}>${this._escape(m.name)}</option>`
            ).join('');

            const styleBadge = STYLE_OPTIONS.find(s => s.name === p.style);
            const badgeColor = styleBadge ? styleBadge.color : '#87CEEB';

            return `
                <div class="player-card">
                    <div class="player-card-header">
                        <span class="player-card-title">
                            <span class="style-badge" style="background:${badgeColor}"></span>
                            玩家 ${i + 1}
                        </span>
                        <button class="pixel-btn pixel-btn-small pixel-btn-danger" onclick="ConfigPanel.removePlayer('${p.id}')">X</button>
                    </div>
                    <div class="form-group">
                        <label class="form-label">名称</label>
                        <input class="pixel-input" value="${this._escape(p.name)}"
                               onchange="ConfigPanel.updatePlayer('${p.id}', 'name', this.value)">
                    </div>
                    <div class="form-group">
                        <label class="form-label">风格</label>
                        <select class="pixel-select"
                                onchange="ConfigPanel.updatePlayer('${p.id}', 'style', this.value)">
                            ${styleOptions}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">模型</label>
                        <select class="pixel-select"
                                onchange="ConfigPanel.updatePlayer('${p.id}', 'model_id', this.value)">
                            <option value="">-- 请选择 --</option>
                            ${modelOptions}
                        </select>
                    </div>
                </div>
            `;
        }).join('');
    },

    updatePlayer(id, field, value) {
        const player = this.players.find(p => p.id === id);
        if (player) {
            player[field] = value;
            if (field === 'style') {
                this.render();
            }
        }
    },

    async saveConfig() {
        // 验证
        for (const p of this.players) {
            if (!p.name) {
                alert('所有玩家都需要填写名称');
                return;
            }
            if (!p.model_id) {
                alert(`玩家"${p.name}"需要选择模型`);
                return;
            }
        }

        const config = {
            players: this.players.map(p => ({
                name: p.name,
                style: p.style,
                model_id: p.model_id,
            })),
            big_blind: parseInt(document.getElementById('settingBigBlind').value) || 100,
            starting_chips: parseInt(document.getElementById('settingChips').value) || 10000,
            max_hands: parseInt(document.getElementById('settingMaxHands').value) || 10,
            action_delay: parseFloat(document.getElementById('settingDelay').value) || 2.0,
            eliminate_on_zero: document.getElementById('settingEliminate').checked,
            blind_increase_interval: parseInt(document.getElementById('settingBlindInc').value) || 0,
        };

        try {
            const res = await authFetch('/api/game/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config),
            });

            if (res.ok) {
                GameLogger.addSystem('游戏配置已保存');
                switchTab('log');
            } else {
                const err = await res.json();
                alert(err.detail || '配置失败');
            }
        } catch (e) {
            alert('连接失败');
        }
    },

    _escape(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },
};
