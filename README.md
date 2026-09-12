# 🃏 Texas Rush - AI 德州扑克大乱斗

一个基于 Web 的 AI 对战德州扑克系统。支持真人参与、内置电脑练习和大语言模型（LLM）对战。打开浏览器即可观战，房间管理员登录后可以入座。

## 特性

- **完整的无限注德州扑克引擎** — 10 种牌型评估、主池/边池分配、庄位轮转
- **LLM 驱动的 AI 决策** — 支持 OpenAI 兼容 API（可接入各类大模型）
- **5 种 AI 风格** — 激进、保守、均衡、诈唬、诡计，各有独特人格
- **跨手牌记忆** — 每个 AI 维护最近 10 手牌摘要，注入对话上下文
- **直接入座练习** — 1 位真人与 3 位内置电脑对手，无需 API Key；练习不覆盖已保存配置
- **清晰的响应式牌桌** — 放大的角色、筹码和手牌；桌面环形座位、手机纵向布局
- **动作提醒** — 牌桌动态栏和座位旁显示刚刚的弃牌、过牌、跟注、加注至或全押，提醒保留 5 秒
- **每手结算** — 中央展示赢家、所得筹码与牌型，分池逐人列出；赢家金色高亮，保留 5 秒再开始下一手，刷新可恢复结算画面
- **真人行动区** — 弃牌 / 过牌 / 跟注 / 加注至 / 全押，显示底牌和 120 秒倒计时；暂停保留剩余时间
- **断线恢复** — 重新连接后恢复当前操作请求，重复点击只提交一次
- **游戏控制** — 开始 / 暂停 / 继续 / 单步 / 重置
- **管理员后台** — 模型配置、玩家管理、游戏参数调整
- **多人同时观看** — WebSocket 广播到所有连接客户端

## 架构

```
┌──────────────────────────────────────────┐
│  前端 (HTML5 Canvas + Vanilla JS)        │
│  响应式 DOM 牌桌 / WebSocket             │
├──────────────────────────────────────────┤
│  后端 (FastAPI + Uvicorn)                │
│  REST API + WebSocket + JWT 认证         │
├──────────────────────────────────────────┤
│  游戏控制层 (game/)                       │
│  状态机 / 下注轮 / 玩家管理              │
├──────────────────────────────────────────┤
│  牌局引擎 (engine/)                       │
│  发牌 / 牌型评估 / 底池管理              │
├──────────────────────────────────────────┤
│  AI 决策层 (ai/)                          │
│  LLM 调用 / Prompt 构建 / 5 种风格       │
└──────────────────────────────────────────┘
```

## 技术栈

| 组件 | 技术 |
|---|---|
| 后端框架 | FastAPI + Uvicorn |
| AI 调用 | OpenAI Python SDK (AsyncOpenAI) |
| 数据校验 | Pydantic v2 |
| 认证 | python-jose (JWT) |
| 前端 | HTML / CSS + Vanilla JS，Canvas 角色头像 |
| 通信 | WebSocket |
| 容器化 | Docker + docker-compose |

## 快速开始

### 方式一：直接运行

```bash
pip install -r requirements.txt
python main.py
# 访问 http://localhost:8000
```

### 方式二：Docker 部署

```bash
docker-compose up -d
# 访问 http://localhost:32431
```

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `GAME_PASSWORD` | `xxx` | 管理员登录密码 |
| `JWT_SECRET` | 自动生成 | JWT 签名密钥 |

## 使用流程

1. 点击「入座练习」，输入房间管理员密码后，自动与 3 位电脑对手开始 10 手练习。
2. 你的座位在牌桌下方；轮到你时，操作区会显示底牌、可执行动作和剩余时间。「加注至」是本轮下注总额。
3. 真人对局中，对手底牌在结算前隐藏；没有真人的 AI 对战保留公开观战。
4. 如果需要大模型对战，登录后进入「模型管理」添加模型，再在「牌桌设置」选择玩家类型和关联模型，保存后点击「开始」。最多 9 个座位，其中最多 1 位真人。
5. 「暂停」保留真人剩余操作时间，「继续」恢复；刷新或短暂断线后可继续当前操作。

练习对手采用简单的过牌、跟注和弃牌规则，适合熟悉流程。更丰富的策略可通过已配置的大模型对手体验。所有筹码仅用于游戏练习。

手机和电脑在同一局域网时，可通过 `http://电脑局域网IP:8000` 访问。登录仍使用同一房间密码。

## 验证

```bash
python3 -m unittest discover -s tests -v
node --test tests/test_frontend.cjs
python3 -m compileall -q ai engine game server main.py tests
git diff --check
```


## API

### REST API

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `GET` | `/` | 公开 | 主页 |
| `POST` | `/api/auth/login` | 公开 | 登录 |
| `GET` | `/api/auth/verify` | 管理员 | 验证 token |
| `GET` | `/api/models` | 管理员 | 获取模型列表 |
| `POST` | `/api/models` | 管理员 | 创建模型 |
| `PUT` | `/api/models/{id}` | 管理员 | 更新模型 |
| `DELETE` | `/api/models/{id}` | 管理员 | 删除模型 |
| `GET` | `/api/game/saved-config` | 管理员 | 获取游戏配置 |
| `POST` | `/api/game/config` | 管理员 | 配置游戏 |
| `GET` | `/api/game/state` | 公开 | 获取游戏状态和待操作请求 |
| `POST` | `/api/game/practice` | 管理员 | 开始内置电脑练习；牌局进行中返回 409 |

### WebSocket

连接 `ws://host/ws`，通过消息体中的 `type` 字段发送控制指令（需携带 `token`）：

`start` / `pause` / `resume` / `step` / `reset` / `human_action`

真人动作携带 `request_id`、`action`、`amount` 和管理员 `token`。`human_action_request` 含可用动作与 `expires_at`（Unix 秒；暂停时为空），重连快照也包含待操作请求。

## AI 风格

| 风格 | 特点 |
|---|---|
| 激进 | 高频加注、全押，施加压力 |
| 保守 | 紧手强牌，稳扎稳打 |
| 均衡 | GTO 策略，攻守兼备 |
| 诈唬 | 高频诈唬，虚虚实实 |
| 诡计 | 变幻莫测，难以捉摸 |

## 项目结构

```
texas-rush/
├── main.py              # 入口文件
├── engine/              # 牌局引擎（发牌、牌型评估、底池）
├── game/                # 游戏控制（状态机、下注轮、玩家）
├── ai/                  # AI 决策（LLM 调用、Prompt、风格）
├── server/              # 服务端（API、WebSocket、认证、存储）
├── static/              # 前端静态文件（HTML/JS/CSS）
├── data/                # 配置数据（模型、游戏配置）
├── Dockerfile           # Docker 构建
├── docker-compose.yml   # Docker 编排
└── requirements.txt     # Python 依赖
```

## License

MIT

### 默认模型

新增模型默认使用 `deepseek-v4-pro`，基础地址为 `https://api.deepseek.com`，实际请求发送到 `https://api.deepseek.com/chat/completions`。也支持在接口地址中直接填写这个完整地址。填写 DeepSeek API Key 并保存后，可在牌桌设置中为 AI 玩家选择该模型；内置练习对手无需模型密钥。已有模型配置不会被覆盖。

也可在项目根目录 `.env` 中设置 `DEEPSEEK_API_KEY=你的密钥`（兼容 `DeepSeekKey`）。启动时会导入为「DeepSeek V4 Pro (.env)」模型；修改密钥后重启服务即可同步。模型配置保存在已忽略的 `data/models.json` 中。
