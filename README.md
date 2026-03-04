# 🃏 Texas Rush - AI 德州扑克大乱斗

一个基于 Web 的 AI 对战德州扑克系统。多个由大语言模型（LLM）驱动的 AI 玩家在牌桌上自动对战，人类用户通过浏览器实时观看 AI 之间的博弈过程。

## 特性

- **完整的无限注德州扑克引擎** — 10 种牌型评估、主池/边池分配、庄位轮转
- **LLM 驱动的 AI 决策** — 支持 OpenAI 兼容 API（可接入各类大模型）
- **5 种 AI 风格** — 激进、保守、均衡、诈唬、诡计，各有独特人格
- **跨手牌记忆** — 每个 AI 维护最近 10 手牌摘要，注入对话上下文
- **实时像素风可视化** — Canvas 渲染 + WebSocket 实时推送
- **游戏控制** — 开始 / 暂停 / 继续 / 单步 / 重置
- **管理员后台** — 模型配置、玩家管理、游戏参数调整
- **多人同时观看** — WebSocket 广播到所有连接客户端

## 架构

```
┌──────────────────────────────────────────┐
│  前端 (HTML5 Canvas + Vanilla JS)        │
│  像素风 UI / Canvas 牌桌 / WebSocket     │
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
| 前端 | HTML5 Canvas + Vanilla JS |
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

1. 访问主页，默认为观众模式，可实时观看牌桌
2. 点击「登录」输入密码进入管理员模式
3. 在「模型」Tab 添加 LLM 模型配置（名称 / API Key / Base URL / Model Name）
4. 在「玩家」Tab 配置 2-9 个 AI 玩家（名称 / 风格 / 关联模型）及游戏参数
5. 点击「开始」，AI 自动对战，所有人实时观看

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
| `GET` | `/api/game/state` | 公开 | 获取游戏状态 |

### WebSocket

连接 `ws://host/ws`，通过消息体中的 `type` 字段发送控制指令（需携带 `token`）：

`start` / `pause` / `resume` / `step` / `reset`

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
