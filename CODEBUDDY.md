# CODEBUDDY.md This file provides guidance to CodeBuddy when working with code in this repository.

## Commands

### Run Locally
```bash
pip install -r requirements.txt
python main.py
# Server starts at http://localhost:8000 with hot reload enabled
```

### Docker Deployment
```bash
docker-compose up -d
# Accessible at http://localhost:32431, data persisted via ./data volume mount
```

### Environment Variables
- `GAME_PASSWORD` — Admin login password (default: `texas2024`)
- `JWT_SECRET` — JWT signing key (auto-generated if not set)

### Testing
```bash
python3 -m unittest discover -s tests -v
node --test tests/test_frontend.cjs
python3 -m compileall -q ai engine game server main.py tests
git diff --check
```

## Development Workflow

### TDD Requirement

All behavior changes must follow TDD:
1. Write the smallest failing test that captures the required behavior.
2. Run the targeted test and confirm it fails for the expected reason.
3. Implement the minimal production code needed to pass.
4. Re-run the targeted test, then the full suite.
5. Refactor only after tests are green.

Prefer focused `unittest` coverage for poker rules, betting flow, AI parsing, stores, and manager/controller behavior. For end-to-end coverage, use FastAPI `TestClient` and WebSocket tests in `tests/` unless a change specifically requires browser-level validation.

Do not write production code first and add tests later for features, bug fixes, or behavioral refactors. Documentation-only edits and throwaway local experiments are exempt, but any committed behavior must have automated coverage.

## Architecture

### Overview

Texas Rush is an AI Texas Hold'em poker platform where LLM-powered AI players auto-battle while humans spectate via browser. The system is a single-process Python application with no database — all persistence uses JSON files in `data/`.

### Layer Architecture (Bottom-Up)

**Engine Layer (`engine/`)** — Pure computational poker primitives, no external dependencies:
- `card.py`: `Card` (frozen dataclass with suit/rank), `Deck` (52-card shuffle/deal)
- `evaluator.py`: `HandEvaluator.evaluate(cards)` — evaluates 5-7 cards by enumerating C(n,5) combinations. Scoring formula: `hand_rank * 10^10 + kickers_weighted`, ensuring any higher hand rank always beats lower ones. Supports all 10 hand types including wheel straights (A-2-3-4-5)
- `pot.py`: `PotManager` — tracks per-player bets, calculates side pots by slicing at each all-in amount, distributes winnings with remainder handling

**Game Layer (`game/`)** — Async state machine driving the game flow:
- `player.py`: `Player` dataclass with persistent fields (id/name/chips/style) and per-hand reset fields (hand/folded/all_in/bets). `bet(amount)` auto-caps at available chips and sets all_in flag
- `betting.py`: `BettingRound` — manages action queue for one betting round. Key behavior: `process_raise()` and raise-type `process_all_in()` call `_reset_action_order_after_raise()` to rebuild the action queue, giving all other players another chance to act
- `controller.py`: `GameController` — the central state machine with 8 stages (WAITING→PREFLOP→FLOP→TURN→RIVER→SHOWDOWN→HAND_COMPLETE→GAME_OVER). Uses `asyncio.Event` for pause/resume/step control. **Decoupled via 3 callbacks**: `on_event` (broadcast), `_ai_decide` (get AI action), `_on_hand_complete` (update memories). Handles dealer rotation, blind posting (special 2-player heads-up rules where dealer=SB), blind escalation, and player elimination

**AI Layer (`ai/`)** — LLM integration for decision-making:
- `styles.py`: 5 personality system prompts (激进/保守/均衡/诈唬/诡计), each with distinct strategic directives and a UI color
- `prompt_builder.py`: `PromptBuilder.build(game_state)` — serializes full game state into structured Chinese prompt including hand, community cards, position (BTN/SB/BB/CO/MP/UTG), pot, bets, available actions with amount ranges. Requires AI to respond with JSON `{action, amount, reasoning}`. Also `build_hand_summary()` for memory injection
- `llm_player.py`: `LLMAIPlayer` — uses `AsyncOpenAI` client (compatible with any OpenAI-API provider via custom `base_url`). Decision flow: build prompt → construct messages (system + memory deque(maxlen=10) + user) → API call (temp=0.7, max_tokens=500, timeout=30s, 3 retries) → dual-layer parsing (JSON extraction then regex fallback) → action validation with auto-correction → fallback to check/fold on total failure

**Server Layer (`server/`)** — FastAPI web server:
- `auth.py`: SHA256 password verification, JWT (HS256, 24h expiry) via `python-jose`, `get_current_admin()` FastAPI dependency
- `model_store.py`: JSON file CRUD (`data/models.json`) for LLM model configs with `asyncio.Lock`
- `config_store.py`: JSON file read/write (`data/game_config.json`) for game configuration persistence
- `schemas.py`: Pydantic v2 models. Note `ModelConfigPublic` strips `api_key` for list responses
- `app.py`: REST routes + WebSocket endpoint. WebSocket at `/ws` handles control commands (start/pause/resume/step/reset) with token auth, and broadcasts all game events
- `game_manager.py`: **Central bridge** singleton. `configure_game()` creates Player objects → LLMAIPlayer instances (fetching model configs from store) → GameController with injected callbacks. `start_game()` launches controller as `asyncio.Task`. Routes AI decisions and memory updates between controller and AI players

**Frontend (`static/`)** — Vanilla JS single-page app with Canvas rendering:
- `index.html`: Loads 7 JS modules in dependency order: auth → card_renderer → table → logger → model_panel → config_panel → app
- `card_renderer.js`: Pixel-art card rendering using 8x8 dot-matrix suit patterns, supports normal/back/dimmed states
- `table.js` (`PokerTable`): Canvas renderer (~660 lines). Elliptical player layout with boundary clamping. 500ms blink loop for thinking indicators. Reasoning bubble system with smart directional placement (above/below based on canvas position), pixel-style borders and tails. Each player's bubble persists until their next thinking event clears it
- `logger.js` (`GameLogger`): CRT-terminal style log panel, per-player color coding, 500-entry cap, formats 10+ event types
- `model_panel.js` / `config_panel.js`: Admin CRUD panels for models and game configuration (2-9 players)
- `app.js`: WebSocket connection with 3s auto-reconnect. Event dispatcher: `player_action` with reasoning → `PokerTable.setReasoning()` for bubble display; state-changing events → `fetchAndUpdateState()` via REST GET

### Key Data Flows

**One Hand Lifecycle**: ConfigPanel POST → `GameManager.configure_game()` → WebSocket "start" → `GameController.run_game()` → `_play_one_hand()`: reset → blinds → deal → [PREFLOP/FLOP/TURN/RIVER betting rounds] → showdown → distribute → eliminate. Each betting action: emit "player_thinking" → callback to `LLMAIPlayer.decide()` → emit "player_action" (with reasoning) → broadcast to all WebSocket clients → frontend renders.

**AI Memory**: After each hand, `GameManager._on_hand_complete()` builds a summary via `PromptBuilder.build_hand_summary()` and calls `update_memory()` on all AI players. The deque(maxlen=10) sliding window keeps recent context manageable.

### Important Conventions

- All game events flow through `GameController.emit_event()` → `GameManager.broadcast()` → WebSocket → frontend `handleGameEvent()`
- Player IDs are 8-char UUID strings generated during `configure_game()`
- The `_ai_decide` callback in GameController expects a return dict with keys: `type`, `amount`, `reasoning`
- Frontend state updates combine WebSocket push events with REST polling (`fetchAndUpdateState()`) for consistency
- Automated tests live in `tests/`; browser testing is still useful for visual/UI verification after frontend changes
- Data files (`data/models.json`, `data/game_config.json`) are auto-created on first write

## Plan Files

历史 plan 文件位于 `.codebuddy/plans/` 目录下：
- `.codebuddy/plans/texas-holdem-ai_8a81a379.md` — 主项目构建计划
- `.codebuddy/plans/cartoon-avatar_902fed9f.md` — 卡通头像功能计划

## Skills

本项目用到的 skills：
- `theme-factory` — 建立像素复古主题规范（颜色、字体、风格关键词）
- `frontend-design` — 实现整体页面结构和 CSS
- `canvas-design` — 设计牌面花色、头像等像素艺术
- `webapp-testing` — 各阶段集成验证（Playwright 截图、浏览器交互测试）


## Responsive Human Play (2026-09)

- `static/js/table_view.js` is the active `PokerTable` implementation. It renders accessible DOM cards and responsive seats; `avatar_renderer.js` still supplies Canvas avatars. `table.js` / `card_renderer.js` remain as the earlier canvas implementation and are not loaded by the homepage.
- `POST /api/game/practice` requires the existing admin login. It starts one human plus three built-in computer opponents without persisting or overwriting saved model/game settings.
- Human games mask AI hole cards and live reasoning in both snapshots and events. AI-only spectator tables remain public. The human seat remains controlled by the room administrator.
- Human requests include an expiry; pause retains the remaining time. Reconnecting clients receive the pending request in the state snapshot.
- Frontend interaction regression tests use Node's built-in runner (`node --test tests/test_frontend.cjs`); no npm install is required.
