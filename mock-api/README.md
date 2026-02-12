# OnlyTrade Mock API

Thin backend service for frontend integration development.

Also acts as the market-data proxy for normalized A-share frames.

## Run

```bash
cd mock-api
npm install
npm run dev
```

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
- `AGENT_DECISION_EVERY_BARS`: trigger agent decision every N replay bars (default `1`).
- `REPLAY_SPEED`: replay speed multiplier for `1m` bars (default `60`).
- `REPLAY_WARMUP_BARS`: initial visible bars before replay starts advancing (default `120`).
- `REPLAY_TICK_MS`: replay engine tick cadence in milliseconds (default `250`).
- `REPLAY_LOOP`: loop replay when reaching end (`true` by default).

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
- `POST /api/agent/runtime/control` (`pause` | `resume` | `step` | `set_cycle_ms`)
- `GET /api/replay/runtime/status`
- `POST /api/replay/runtime/control` (`pause` | `resume` | `step` | `set_speed` | `set_cursor`)

Runtime control examples:

```bash
curl "http://localhost:8080/api/agent/runtime/status"
curl -X POST "http://localhost:8080/api/agent/runtime/control" -H "Content-Type: application/json" -d '{"action":"pause"}'
curl -X POST "http://localhost:8080/api/agent/runtime/control" -H "Content-Type: application/json" -d '{"action":"set_cycle_ms","cycle_ms":8000}'
curl -X POST "http://localhost:8080/api/agent/runtime/control" -H "Content-Type: application/json" -d '{"action":"step"}'
curl -X POST "http://localhost:8080/api/agent/runtime/control" -H "Content-Type: application/json" -d '{"action":"resume"}'
curl "http://localhost:8080/api/replay/runtime/status"
curl -X POST "http://localhost:8080/api/replay/runtime/control" -H "Content-Type: application/json" -d '{"action":"step"}'
curl -X POST "http://localhost:8080/api/replay/runtime/control" -H "Content-Type: application/json" -d '{"action":"set_speed","speed":60}'
```

## Notes

- Serves contract-shaped endpoints used by `/lobby`, `/room`, `/leaderboard`.
- Loads replay data from `onlytrade-web/public/replay/cn-a/latest/frames.1m.json` when available.
- Loads daily history from `onlytrade-web/public/replay/cn-a/history/frames.1d.90.json` (or lookback from env) when available.
- Falls back to generated mock bars if replay is missing.
- Normalizes upstream payloads into canonical `market.bar.v1` frames.
- Runs an in-memory mock agent runtime that emits decision records consumed by room UI.
- Agent decisions are event-time driven by replay bar advancement (production-style decoupled infra, coupled by market events).
