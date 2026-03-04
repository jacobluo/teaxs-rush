/**
 * 模型管理面板（管理员专属）
 */

const ModelPanel = {
    models: [],
    editingId: null,

    async loadModels() {
        try {
            const res = await authFetch('/api/models');
            if (res.ok) {
                this.models = await res.json();
                this.render();
            }
        } catch (e) {
            console.error('加载模型失败:', e);
        }
    },

    render() {
        const list = document.getElementById('modelList');
        if (!list) return;

        if (this.models.length === 0) {
            list.innerHTML = '<div style="color:#7A9BB5;font-size:11px;text-align:center;padding:20px;">暂无模型</div>';
            return;
        }

        list.innerHTML = this.models.map(m => `
            <div class="model-item">
                <div>
                    <div class="model-item-name">${this._escape(m.name)}</div>
                    <div style="font-size:10px;color:#7A9BB5;margin-top:2px;">${this._escape(m.model_name)}</div>
                </div>
                <div class="model-item-actions">
                    <button class="pixel-btn pixel-btn-small" onclick="ModelPanel.showEditForm('${m.id}')">编辑</button>
                    <button class="pixel-btn pixel-btn-small pixel-btn-danger" onclick="ModelPanel.deleteModel('${m.id}')">删除</button>
                </div>
            </div>
        `).join('');
    },

    showAddForm() {
        this.editingId = null;
        this._renderForm({ name: '', api_key: '', base_url: '', model_name: '' });
    },

    showEditForm(id) {
        const model = this.models.find(m => m.id === id);
        if (!model) return;
        this.editingId = id;
        this._renderForm({ ...model, api_key: '' });
    },

    _renderForm(data) {
        const container = document.getElementById('modelFormContainer');
        container.innerHTML = `
            <div class="player-card" style="margin-bottom:10px;">
                <div class="player-card-header">
                    <span class="player-card-title">${this.editingId ? '编辑模型' : '新增模型'}</span>
                    <button class="pixel-btn pixel-btn-small pixel-btn-danger" onclick="ModelPanel.hideForm()">X</button>
                </div>
                <div class="form-group">
                    <label class="form-label">名称</label>
                    <input class="pixel-input" id="modelName" value="${this._escape(data.name)}" placeholder="例如 GPT-4o">
                </div>
                <div class="form-group">
                    <label class="form-label">API 密钥</label>
                    <input class="pixel-input" id="modelApiKey" type="password" value="${this._escape(data.api_key)}" placeholder="sk-...">
                </div>
                <div class="form-group">
                    <label class="form-label">接口地址</label>
                    <input class="pixel-input" id="modelBaseUrl" value="${this._escape(data.base_url)}" placeholder="https://api.openai.com/v1">
                </div>
                <div class="form-group">
                    <label class="form-label">模型名称</label>
                    <input class="pixel-input" id="modelModelName" value="${this._escape(data.model_name)}" placeholder="gpt-4o">
                </div>
                <button class="pixel-btn pixel-btn-primary" style="width:100%" onclick="ModelPanel.saveModel()">保存</button>
            </div>
        `;
    },

    hideForm() {
        document.getElementById('modelFormContainer').innerHTML = '';
        this.editingId = null;
    },

    async saveModel() {
        const body = {
            name: document.getElementById('modelName').value,
            api_key: document.getElementById('modelApiKey').value,
            base_url: document.getElementById('modelBaseUrl').value,
            model_name: document.getElementById('modelModelName').value,
        };

        if (!body.name || !body.api_key || !body.base_url || !body.model_name) {
            alert('所有字段均为必填');
            return;
        }

        try {
            const url = this.editingId ? `/api/models/${this.editingId}` : '/api/models';
            const method = this.editingId ? 'PUT' : 'POST';

            const res = await authFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (res.ok) {
                this.hideForm();
                await this.loadModels();
                GameLogger.addSystem(`模型已${this.editingId ? '更新' : '添加'}: ${body.name}`);
            }
        } catch (e) {
            console.error('保存模型失败:', e);
        }
    },

    async deleteModel(id) {
        if (!confirm('确定要删除该模型吗？')) return;

        try {
            const res = await authFetch(`/api/models/${id}`, { method: 'DELETE' });
            if (res.ok) {
                await this.loadModels();
                GameLogger.addSystem('模型已删除');
            }
        } catch (e) {
            console.error('删除模型失败:', e);
        }
    },

    _escape(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },
};
