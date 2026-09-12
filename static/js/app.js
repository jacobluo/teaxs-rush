/**
 * 前端主入口：WebSocket 连接、Tab 切换、游戏控制、初始化
 */

let ws = null;
let reconnectTimer = null;
const RECONNECT_DELAY = 3000;
let pendingHumanAction = null;
let renderedRequestId = null;
let submittedRequestId = null;
let practiceAfterLogin = false;
let stateFetchCounter = 0;

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
        submittedRequestId = null;
        fetchAndUpdateState();
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
    updateActionAvailability();
}

// ========== 游戏事件处理 ==========
function handleGameEvent(message) {
    const { type, data } = message;
    stateFetchCounter++;

    // 更新日志
    GameLogger.addLog(message);

    // 更新牌桌状态
    switch (type) {
        case 'game_state':
            PokerTable.updateState(data);
            updateStatusFromState(data);
            break;
        case 'game_configured':
            if (data.players) {
                PokerTable.updateState(data.config ? { ...data, stage: 'waiting', pot: 0, community_cards: [], dealer_index: 0 } : data);
            }
            fetchAndUpdateState();
            break;

        case 'hand_start':
            PokerTable.updateState({...PokerTable.state, hand_number:data.hand_number, stage:'preflop', hand_result:null});
            updateStatusBar(data);
            break;

        case 'community_cards':
            PokerTable.updateState({...PokerTable.state, stage:data.stage, community_cards:data.cards, thinking_player_id:null,
                players:(PokerTable.state?.players || []).map(p => ({...p, last_action:'', last_action_amount:0, current_bet:0}))});
            updateStage(data.stage);
            fetchAndUpdateState();
            break;

        case 'deal_hole_cards':
            // 请求最新状态
            fetchAndUpdateState();
            break;

        case 'player_action':
            PokerTable.showAction(data);
            // 传递推理过程到牌桌气泡（气泡持续到下一个玩家出牌）
            if (data.reasoning && data.player?.id) {
                PokerTable.setReasoning(data.player.id, data.reasoning);
            }
            fetchAndUpdateState();
            break;

        case 'player_thinking':
            // 该玩家开始新一轮思考，清除其旧的推理气泡
            if (data.player_id) {
                PokerTable.clearPlayerBubble(data.player_id);
            }
            // 标记当前思考中的玩家，触发闪烁灯
            if (PokerTable.state) {
                PokerTable.state.thinking_player_id = data.player_id;
                PokerTable._render();
            }
            break;

        case 'human_action_request':
            pendingHumanAction = data;
            renderHumanActionPanel(data);
            fetchAndUpdateState();
            break;

        case 'human_action_clear':
            if (!pendingHumanAction || pendingHumanAction.request_id === data.request_id) {
                pendingHumanAction = null;
                hideHumanActionPanel();
            }
            break;

        case 'human_action_timeout':
            pendingHumanAction = null;
            hideHumanActionPanel();
            break;

        case 'betting_round_start':
            updateStage(data.stage);
            break;

        case 'hand_complete':
            PokerTable.showHandResult(data);
            showNotice((data.winners || []).map(w => `${w.player.name} 赢得 ${w.amount.toLocaleString()} 筹码`).join(' · '));
            PokerTable.clearReasoningBubbles();
            fetchAndUpdateState();
            break;

        case 'game_paused':
        case 'game_resumed':
            PokerTable.updateState({...PokerTable.state, is_paused: type === 'game_paused'});
            updateTableControls(PokerTable.state);
            fetchAndUpdateState();
            break;

        case 'game_start':
            fetchAndUpdateState();
            break;

        case 'error':
            submittedRequestId = null;
            showNotice(data.message || '操作失败');
            fetchAndUpdateState();
            break;

        case 'game_over':
        case 'game_reset':
            PokerTable.clearReasoningBubbles();
            fetchAndUpdateState();
            break;

        case 'blind_increase':
            updateBlinds(data.small_blind, data.big_blind);
            break;
    }
}

async function fetchAndUpdateState() {
    const requestNumber = ++stateFetchCounter;
    try {
        const res = await fetch('/api/game/state');
        if (res.ok) {
            const state = await res.json();
            if (requestNumber !== stateFetchCounter) return;
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
    if (state.pending_human_action) {
        pendingHumanAction = state.pending_human_action;
        renderHumanActionPanel(pendingHumanAction);
    } else {
        pendingHumanAction = null;
        hideHumanActionPanel();
    }
    updateTableControls(state);
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

    if (action === 'pause' && PokerTable.state?.is_paused) action = 'resume';
    ws.send(JSON.stringify({ type: action, token }));
}

// ========== 人类玩家操作 ==========
function renderHumanActionPanel(request) {
    const panel = document.getElementById('humanActionPanel');
    const title = document.getElementById('humanActionTitle');
    const hint = document.getElementById('humanActionHint');
    const controls = document.getElementById('humanActionControls');
    if (!panel || !controls) return;

    if (!isAdmin()) {
        hideHumanActionPanel();
        return;
    }

    panel.classList.add('active');
    if (renderedRequestId === request.request_id) { updateActionAvailability(); return; }
    renderedRequestId = request.request_id;
    submittedRequestId = null;
    const available = request.available_actions || {};
    title.textContent = '轮到你了';
    const toCall = available.to_call || 0;
    const minRaiseTo = available.min_raise_to || 0;
    const maxRaiseTo = available.max_raise_to || 0;
    hint.textContent = toCall > 0
        ? `跟注需 ${toCall.toLocaleString()} 筹码 · 加注金额为本轮总额`
        : '可免费过牌，也可以加注';

    const buttons = [];
    if (available.can_fold) {
        buttons.push(`<button class="pixel-btn pixel-btn-small pixel-btn-danger" onclick="sendHumanAction('fold')">弃牌</button>`);
    }
    if (available.can_check) {
        buttons.push(`<button class="pixel-btn pixel-btn-small" onclick="sendHumanAction('check')">过牌</button>`);
    }
    if (available.can_call) {
        buttons.push(`<button class="pixel-btn pixel-btn-small" onclick="sendHumanAction('call')">跟注 $${toCall}</button>`);
    }
    if (available.can_raise) {
        buttons.push(`
            <div class="raise-control">
                <input class="pixel-input raise-input" id="humanRaiseAmount"
                       aria-label="加注至" type="number" inputmode="numeric" min="${minRaiseTo}" max="${maxRaiseTo}" step="1"
                       value="${minRaiseTo}">
                <button class="pixel-btn pixel-btn-small pixel-btn-primary" onclick="sendHumanAction('raise')">加注至</button>
            </div>
        `);
    }
    if (available.can_all_in) {
        buttons.push(`<button class="pixel-btn pixel-btn-small pixel-btn-primary" onclick="sendHumanAction('all_in')">全押</button>`);
    }

    controls.innerHTML = buttons.join('');
    updateActionAvailability();
}

function hideHumanActionPanel() {
    renderedRequestId = null;
    submittedRequestId = null;
    const panel = document.getElementById('humanActionPanel');
    const controls = document.getElementById('humanActionControls');
    if (panel) panel.classList.remove('active');
    if (controls) controls.innerHTML = '';
}

function sendHumanAction(action) {
    if (pendingHumanAction && submittedRequestId === pendingHumanAction.request_id) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        GameLogger.addSystem('未连接到服务器');
        return;
    }
    if (!pendingHumanAction) {
        GameLogger.addSystem('当前没有等待中的人类玩家操作');
        return;
    }

    const token = getToken();
    if (!token) {
        GameLogger.addSystem('需要管理员登录');
        return;
    }

    let amount = 0;
    if (action === 'raise') {
        const input = document.getElementById('humanRaiseAmount');
        if (!input || !input.reportValidity()) return;
        amount = Number(input.value);
        if (!Number.isInteger(amount)) return;
    }

    submittedRequestId = pendingHumanAction.request_id;
    updateActionAvailability();
    ws.send(JSON.stringify({
        type: 'human_action',
        token,
        request_id: pendingHumanAction.request_id,
        action,
        amount,
    }));
}

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', async () => {
    // 初始化模块
    GameLogger.init();
    PokerTable.init(document.getElementById('pokerTable'));
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


function updateActionAvailability() {
    const offline = !ws || ws.readyState !== WebSocket.OPEN;
    const sending = pendingHumanAction && submittedRequestId === pendingHumanAction.request_id;
    document.querySelectorAll('#humanActionControls button, #humanActionControls input').forEach(el => {
        el.disabled = offline || !!sending || !!PokerTable.state?.is_paused;
    });
    const hand = document.getElementById('humanActionHand');
    const player = PokerTable.state?.players?.find(p => p.player_type === 'human');
    const cards = player ? (player.hand || []).map(c => PokerTable._card(c)).join('') : '';
    if (hand && hand.innerHTML !== cards) hand.innerHTML = cards;
    const countdown = document.getElementById('actionCountdown');
    if (countdown) {
        const left = pendingHumanAction?.expires_at ? Math.max(0, Math.ceil(pendingHumanAction.expires_at - Date.now() / 1000)) : null;
        countdown.textContent = PokerTable.state?.is_paused ? '已暂停 · 操作时间保留' : offline ? '连接已断开，正在重连' : sending ? '正在提交…' : left === null ? '' : `${left} 秒 · 超时自动过牌或弃牌`;
    }
}
setInterval(updateActionAvailability, 1000);

function updateTableControls(state) {
    const running = !!state.is_running;
    document.getElementById('btnPause').textContent = state.is_paused ? '继续' : '暂停';
    document.getElementById('btnPause').disabled = !running;
    document.getElementById('btnStart').disabled = running || !state.players?.length || state.stage === 'game_over';
    document.getElementById('btnJoin').disabled = running;
    document.getElementById('btnJoin').textContent = state.stage === 'game_over' ? '再来一局' : running ? '牌局进行中' : '入座练习';
    updateActionAvailability();
}

function showNotice(message) {
    document.getElementById('tableNotice').textContent = message;
}

async function joinPractice() {
    if (!isAdmin()) {
        practiceAfterLogin = true;
        showLoginModal();
        return;
    }
    const button = document.getElementById('btnJoin');
    button.disabled = true;
    try {
        const response = await authFetch('/api/game/practice', {method:'POST'});
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || '开局失败');
        showNotice('已入座。你的手牌在牌桌下方，轮到你时会显示操作按钮。');
        await fetchAndUpdateState();
    } catch (error) {
        showNotice(error.message || '连接失败，请重试');
    } finally {
        button.disabled = !!PokerTable.state?.is_running;
    }
}
