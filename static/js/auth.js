/**
 * 认证模块：登录弹窗、token 管理、角色切换
 */

const TOKEN_KEY = 'texas_admin_token';

function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
}

function isAdmin() {
    return !!getToken();
}

function showLoginModal() {
    document.getElementById('loginModal').classList.add('active');
    document.getElementById('loginPassword').value = '';
    document.getElementById('loginError').textContent = '';
    document.getElementById('loginPassword').focus();
}

function hideLoginModal() {
    document.getElementById('loginModal').classList.remove('active');
}

async function doLogin() {
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');

    if (!password) {
        errorEl.textContent = '请输入密码';
        return;
    }

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
        });

        if (res.ok) {
            const data = await res.json();
            setToken(data.token);
            hideLoginModal();
            updateUIForRole();
            GameLogger.addSystem('管理员登录成功');
            // 登录成功后加载模型列表和已保存的游戏配置
            await ModelPanel.loadModels();
            await ConfigPanel.loadSavedConfig();
        } else {
            errorEl.textContent = '密码错误';
        }
    } catch (e) {
        errorEl.textContent = '连接失败';
    }
}

function logout() {
    clearToken();
    updateUIForRole();
    GameLogger.addSystem('管理员已登出');
}

function updateUIForRole() {
    const admin = isAdmin();

    if (admin) {
        document.body.classList.add('is-admin');
        document.getElementById('btnLogin').style.display = 'none';
        document.getElementById('btnAdminLabel').style.display = 'inline';
        document.getElementById('btnLogout').style.display = 'inline';
    } else {
        document.body.classList.remove('is-admin');
        document.getElementById('btnLogin').style.display = 'inline';
        document.getElementById('btnAdminLabel').style.display = 'none';
        document.getElementById('btnLogout').style.display = 'none';

        // 切换到日志 tab
        switchTab('log');
    }
}

async function verifyExistingToken() {
    const token = getToken();
    if (!token) return false;

    try {
        const res = await fetch('/api/auth/verify', {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        return res.ok;
    } catch {
        return false;
    }
}

function authFetch(url, options = {}) {
    const token = getToken();
    if (token) {
        options.headers = options.headers || {};
        options.headers['Authorization'] = `Bearer ${token}`;
    }
    return fetch(url, options);
}
