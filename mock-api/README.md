# OnlyTrade Mock API

Thin backend service for frontend integration development.

Also acts as the market-data proxy for normalized A-share frames.

## Run

```bash
cd mock-api
npm install
npm run dev
```

Env loading:

- The server auto-loads `mock-api/.env.local` first, then `mock-api/.env`.
- Existing shell environment variables still take precedence.
- Start from `mock-api/.env.example`.

Default port: `8080`

## Realtime Proxy Modes

- `MARKET_PROVIDER=mock` (default): generated/mock + replay-backed frames.
- `MARKET_PROVIDER=real`: pull bars from `MARKET_UPSTREAM_URL`, normalize to `market.bar.v1`, fallback to replay/mock on upstream failures.

Optional env vars:

- `MARKET_UPSTREAM_URL`: HTTP endpoint for upstream provider proxy.
- `MARKET_UPSTREAM_API_KEY`: bearer token sent to upstream proxy.
- `MARKET_STREAM_POLL_MS`: SSE polling cadence in milliseconds (default `500`).
- `MARKET_DAILY_HISTORY_DAYS`: daily history file lookback suffix (default `90`, reads `frames.1d.<days>.json`).
- `AGENT_RUNTIME_CYCLE_MS`: mock agent decision cycle cadence in milliseconds (default `15000`).
- `AGENT_DECISION_EVERY_BARS`: trigger agent decision every N replay bars (default `10`, i.e. every 10 minutes of market data in `1m` replay).
- `AGENT_COMMISSION_RATE`: commission applied per buy/sell turnover (default `0.0003` = 3 bps).
- `REPLAY_SPEED`: replay speed multiplier for `1m` bars (default `60`).
- `REPLAY_WARMUP_BARS`: initial visible bars before replay starts advancing (default `120`).
- `REPLAY_TICK_MS`: replay engine tick cadence in milliseconds (default `250`).
- `REPLAY_LOOP`: loop replay when reaching end (`true` by default).
- `OPENAI_API_KEY`: enables LLM decisions via OpenAI chat completions.
- `OPENAI_MODEL`: OpenAI model name for decisions (default `gpt-4o-mini`).
- `OPENAI_BASE_URL`: optional OpenAI-compatible base URL (default `https://api.openai.com/v1`).
- `AGENT_LLM_ENABLED`: set `false` to force heuristic-only decisions.
- `AGENT_LLM_TIMEOUT_MS`: LLM request timeout in milliseconds (default `7000`).
- `AGENT_LLM_DEV_TOKEN_SAVER`: default `true`; uses compact prompt/context to reduce token usage in development.
- `AGENT_LLM_MAX_OUTPUT_TOKENS`: cap model output tokens (default `180`).
- `CONTROL_API_TOKEN`: optional bearer/token for protected runtime control endpoints (recommended for kill switch).
- `RESET_AGENT_MEMORY_ON_BOOT`: set `true` to wipe/reinitialize `data/agent-memory/*.json` at startup.

Example:

```bash
MARKET_PROVIDER=real MARKET_UPSTREAM_URL=https://your-proxy.example/api/market/frames npm run dev
```

## Market Data Endpoints

- `GET /api/market/frames?symbol=600519.SH&interval=1m&limit=500`
- `GET /api/klines?symbol=600519.SH&interval=1m&limit=500`
- `GET /api/market/stream?symbols=600519.SH,300750.SZ&interval=1m`
- `GET /api/agent/market-context?symbol=600519.SH&intraday_interval=1m&intraday_limit=180&daily_limit=90`
- `GET /api/decisions/latest?trader_id=t_001&limit=5`
- `GET /api/agent/runtime/status`
- `POST /api/agent/runtime/control` (`pause` | `resume` | `step` | `set_cycle_ms` | `set_decision_every_bars`)
- `POST /api/agent/runtime/kill-switch` (`activate` | `deactivate`) - emergency stop of all agent decisions + LLM calls
- `GET /api/agent/memory?trader_id=t_001`
- `GET /api/replay/runtime/status`
- `POST /api/replay/runtime/control` (`pause` | `resume` | `step` | `set_speed` | `set_cursor`)
- `POST /api/dev/factory-reset` (dev-only: pause runtimes, reset replay cursor, clear runtime metrics/history, reset memory JSON)

Runtime control examples:

```bash
curl "http://localhost:8080/api/agent/runtime/status"
curl -X POST "http://localhost:8080/api/agent/runtime/control" -H "Content-Type: application/json" -d '{"action":"pause"}'
curl -X POST "http://localhost:8080/api/agent/runtime/control" -H "Content-Type: application/json" -d '{"action":"set_decision_every_bars","decision_every_bars":3}'
curl -X POST "http://localhost:8080/api/agent/runtime/control" -H "Content-Type: application/json" -d '{"action":"step"}'
curl -X POST "http://localhost:8080/api/agent/runtime/control" -H "Content-Type: application/json" -d '{"action":"resume"}'
curl -X POST "http://localhost:8080/api/agent/runtime/kill-switch" -H "Content-Type: application/json" -d '{"action":"activate","reason":"manual_emergency_stop"}'
curl -X POST "http://localhost:8080/api/agent/runtime/kill-switch" -H "Content-Type: application/json" -d '{"action":"deactivate"}'
curl "http://localhost:8080/api/replay/runtime/status"
curl -X POST "http://localhost:8080/api/replay/runtime/control" -H "Content-Type: application/json" -d '{"action":"step"}'
curl -X POST "http://localhost:8080/api/replay/runtime/control" -H "Content-Type: application/json" -d '{"action":"set_speed","speed":60}'
curl -X POST "http://localhost:8080/api/dev/factory-reset" -H "Content-Type: application/json" -d '{"cursor_index":0}'
```

Factory reset options:

- Runtime reset without restart: `POST /api/dev/factory-reset` (default rewinds to cursor `0`)
- Warmup reset cursor: `POST /api/dev/factory-reset` with `{"use_warmup":true}`
- Startup auto-reset: set `RESET_AGENT_MEMORY_ON_BOOT=true`

## Notes

- Serves contract-shaped endpoints used by `/lobby`, `/room`, `/leaderboard`.
- Loads replay data from `onlytrade-web/public/replay/cn-a/latest/frames.1m.json` when available.
- Loads daily history from `onlytrade-web/public/replay/cn-a/history/frames.1d.90.json` (or lookback from env) when available.
- Falls back to generated mock bars if replay is missing.
- Normalizes upstream payloads into canonical `market.bar.v1` frames.
- Runs an in-memory mock agent runtime that emits decision records consumed by room UI.
- Agent decisions are event-time driven by replay bar advancement and default to every 10 replay bars (10m market-time cadence).
- Persists per-trader long-term memory snapshots to `data/agent-memory/<trader_id>.json` with stable schema (`agent.memory.v2`).
- Applies commission on each buy/sell decision and tracks fees in memory stats (`total_fees_paid`).
- LLM output uses strict JSON Schema (`decisions` array with exactly one decision item) and falls back to heuristic logic on format/API failures.

### Agent memory JSON layout (`agent.memory.v2`)

Top-level sections in each `data/agent-memory/<trader_id>.json` file:

- `schema_version`, `meta`: schema id + run metadata (`run_id`, `created_at`, `updated_at`)
- `config`: runtime knobs persisted with snapshot (`initial_balance`, `decision_every_bars`, `llm_model`, etc.)
- `replay`: latest replay cursor/day state (`trading_day`, `day_index`, `bar_cursor`, `is_day_start`, `is_day_end`)
- `stats`: rolling trader performance summary (`return_rate_pct`, wins/losses/holds, peak/trough)
- `daily_journal`: per-trading-day compact rollups (start/end/peak/trough + action counts)
- `holdings`: latest position-level snapshot
- `recent_actions`: most recent decision actions (latest first, capped)
