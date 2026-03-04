/**
 * 前端主入口：WebSocket 连接、Tab 切换、游戏控制、初始化
 */

let ws = null;
let reconnectTimer = null;
const RECONNECT_DELAY = 3000;

// ========== Tab 切换 ==========
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`);
    });

    // 切换到模型 tab 时加载数据
    if (tabName === 'models' && isAdmin()) {
        ModelPanel.loadModels();
    }
    if (tabName === 'players' && isAdmin()) {
        ModelPanel.loadModels().then(() => ConfigPanel.render());
    }
}

// ========== WebSocket ==========
function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        updateConnectionStatus(true);
        GameLogger.addSystem('已连接到服务器');
    };

    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            handleGameEvent(message);
        } catch (e) {
            console.error('消息解析失败:', e);
        }
    };

    ws.onclose = () => {
        updateConnectionStatus(false);
        scheduleReconnect();
    };

    ws.onerror = () => {
        updateConnectionStatus(false);
    };
}

function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
        GameLogger.addSystem('正在重连...');
        connectWebSocket();
    }, RECONNECT_DELAY);
}

function updateConnectionStatus(connected) {
    const el = document.getElementById('connectionStatus');
    if (connected) {
        el.textContent = '● 在线';
        el.className = 'connection-status connected';
    } else {
        el.textContent = '● 离线';
        el.className = 'connection-status disconnected';
    }
}

// ========== 游戏事件处理 ==========
function handleGameEvent(message) {
    const { type, data } = message;

    // 更新日志
    GameLogger.addLog(message);

    // 更新牌桌状态
    switch (type) {
        case 'game_state':
        case 'game_configured':
            if (data.players) {
                PokerTable.updateState(data.config ? { ...data, stage: 'waiting', pot: 0, community_cards: [], dealer_index: 0 } : data);
            }
            break;

        case 'hand_start':
            updateStatusBar(data);
            break;

        case 'deal_hole_cards':
        case 'player_action':
        case 'community_cards':
            // 请求最新状态
            fetchAndUpdateState();
            break;

        case 'player_thinking':
            // 标记当前思考中的玩家，触发闪烁灯
            if (PokerTable.state) {
                PokerTable.state.thinking_player_id = data.player_id;
                PokerTable._render();
            }
            break;

        case 'betting_round_start':
            updateStage(data.stage);
            break;

        case 'hand_complete':
            fetchAndUpdateState();
            break;

        case 'game_over':
        case 'game_reset':
            fetchAndUpdateState();
            break;

        case 'blind_increase':
            updateBlinds(data.small_blind, data.big_blind);
            break;
    }
}

async function fetchAndUpdateState() {
    try {
        const res = await fetch('/api/game/state');
        if (res.ok) {
            const state = await res.json();
            PokerTable.updateState(state);
            updateStatusFromState(state);
        }
    } catch (e) {
        // 静默失败
    }
}

// ========== 状态栏更新 ==========
function updateStatusBar(data) {
    if (data.hand_number !== undefined) {
        document.getElementById('statusHand').textContent = `第 ${data.hand_number} 手`;
    }
    if (data.small_blind !== undefined && data.big_blind !== undefined) {
        updateBlinds(data.small_blind, data.big_blind);
    }
}

function updateBlinds(sb, bb) {
    document.getElementById('statusBlinds').textContent = `小/大盲: $${sb}/$${bb}`;
}

function updateStage(stage) {
    const stages = ['preflop', 'flop', 'turn', 'river'];
    const ids = ['stagePreflop', 'stageFlop', 'stageTurn', 'stageRiver'];

    ids.forEach((id, i) => {
        const el = document.getElementById(id);
        el.classList.toggle('active', stages[i] === stage);
    });
}

function updateStatusFromState(state) {
    if (state.hand_number !== undefined) {
        document.getElementById('statusHand').textContent = `第 ${state.hand_number} 手`;
    }
    if (state.stage) {
        updateStage(state.stage);
    }
    if (state.small_blind !== undefined && state.big_blind !== undefined) {
        updateBlinds(state.small_blind, state.big_blind);
    }
    if (state.players) {
        const total = state.players.length;
        const alive = state.players.filter(p => !p.is_eliminated).length;
        document.getElementById('statusAlive').textContent = `存活: ${alive}/${total}`;
    }
}

// ========== 游戏控制 ==========
function sendControl(action) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        GameLogger.addSystem('未连接到服务器');
        return;
    }

    const token = getToken();
    if (!token) {
        GameLogger.addSystem('需要管理员登录');
        return;
    }

    ws.send(JSON.stringify({ type: action, token }));
}

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', async () => {
    // 初始化模块
    GameLogger.init();
    PokerTable.init(document.getElementById('pokerCanvas'));
    ConfigPanel.init();

    // 检查登录状态
    const valid = await verifyExistingToken();
    if (valid) {
        updateUIForRole();
        await ModelPanel.loadModels();
        // 加载上次保存的游戏配置（玩家信息 + 游戏参数）
        await ConfigPanel.loadSavedConfig();
    } else {
        clearToken();
        updateUIForRole();
    }

    // 连接 WebSocket
    connectWebSocket();

    // 获取初始状态
    fetchAndUpdateState();

    GameLogger.addSystem('德州大乱斗已启动');
});
