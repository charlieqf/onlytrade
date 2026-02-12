# API Contracts (MVP)

This project follows a contract-first approach.

- Contracts are defined here.
- Example payloads live in `onlytrade-web/tests/fixtures/`.
- Backend should serve these shapes (fixtures first, then real implementations behind the same contracts).
- Market data uses one canonical schema for both mock and real modes (`market.bar.v1`).

## Conventions

Base URL: `/api`

Most endpoints use the NOFX-style response wrapper:

```json
{ "success": true, "data": { } }
```

Exceptions:
- `GET /api/config` returns raw JSON (no wrapper).

## Endpoints

## Core Frontend Data Surface (Current UI)

The near-finished frontend (`/lobby`, `/room`, `/leaderboard`) currently depends on these endpoints:

- `GET /api/config`
- `GET /api/traders`
- `GET /api/competition`
- `GET /api/status?trader_id=`
- `GET /api/account?trader_id=`
- `GET /api/positions?trader_id=`
- `GET /api/decisions/latest?trader_id=&limit=`
- `GET /api/equity-history?trader_id=&hours=`
- `POST /api/equity-history-batch`
- `GET /api/positions/history?trader_id=&limit=`
- `GET /api/symbols?exchange=sim-cn`
- `GET /api/market/frames?symbol=&interval=&limit=`
- `GET /api/klines?symbol=&interval=&limit=&exchange=`
- `GET /api/orders?trader_id=&symbol=&status=&limit=`
- `GET /api/open-orders?trader_id=&symbol=`

Optional next-step interaction endpoints for backend implementation:

- `POST /api/rooms/:room_id/ask`
- `POST /api/rooms/:room_id/fuel`
- `GET /api/rooms/:room_id/events`

### GET /api/config

Raw JSON:

```json
{ "beta_mode": true, "registration_enabled": false }
```

Fixture: `onlytrade-web/tests/fixtures/api_config.json`

### GET /api/competition

Wrapped:

```json
{
  "success": true,
  "data": {
    "count": 2,
    "traders": [
      {
        "trader_id": "t_001",
        "trader_name": "HS300 Momentum",
        "ai_model": "qwen",
        "exchange": "sim",
        "total_equity": 102345.12,
        "total_pnl": 2345.12,
        "total_pnl_pct": 2.35,
        "position_count": 3,
        "margin_used_pct": 0,
        "is_running": true
      }
    ]
  }
}
```

Fixture: `onlytrade-web/tests/fixtures/api_competition.json`

Runtime extension: payload may include `replay` metadata (`trading_day`, `day_index`, `day_count`, `day_bar_index`, `day_bar_count`) so leaderboard context can align with replay progress.

### GET /api/traders

Public trader list (wrapped):

```json
{
  "success": true,
  "data": [
    { "trader_id": "t_001", "trader_name": "HS300 Momentum", "ai_model": "qwen", "is_running": true }
  ]
}
```

Fixture: `onlytrade-web/tests/fixtures/api_traders.json`

### GET /api/status?trader_id=

Wrapped `SystemStatus` payload.

Fixture: `onlytrade-web/tests/fixtures/api_status.json`

### GET /api/account?trader_id=

Wrapped `AccountInfo` payload.

Fixture: `onlytrade-web/tests/fixtures/api_account.json`

### GET /api/positions?trader_id=

Wrapped list of `Position`.

Fixture: `onlytrade-web/tests/fixtures/api_positions.json`

### GET /api/decisions/latest?trader_id=&limit=

Wrapped list of `DecisionRecord`.

Fixture: `onlytrade-web/tests/fixtures/api_decisions_latest.json`

### GET /api/agent/runtime/status

Wrapped runtime status payload used by room runtime controls.

- Includes `running`, in-flight timestamps, aggregate metrics, per-trader call counts, `decision_every_bars` cadence, `kill_switch` state, and `llm` runtime descriptor (`enabled`, `effective_enabled`, token-saver flags).

### POST /api/agent/runtime/control

Runtime control endpoint for demo operations.

Request body:

```json
{ "action": "pause" }
```

Supported `action` values:

- `pause`
- `resume`
- `step`
- `set_cycle_ms` (requires `cycle_ms`; maps to `decision_every_bars` under current replay speed)
- `set_decision_every_bars` (requires `decision_every_bars`)

### POST /api/agent/runtime/kill-switch

Emergency control endpoint to stop all agent decisions and block LLM calls.

Request body:

```json
{ "action": "activate", "reason": "manual_emergency_stop" }
```

Supported `action` values:

- `activate`
- `deactivate`

Notes:

- Activation pauses runtime + replay and clears queued decision steps.
- If `CONTROL_API_TOKEN` is configured, request must include valid `x-control-token` header (or bearer token).

### GET /api/agent/memory?trader_id=

Persistent agent long-term memory snapshot.

- Backed by JSON files at `data/agent-memory/<trader_id>.json`.
- Includes replay day state, equity/return stats, holdings snapshot, and recent actions.
- Current schema version: `agent.memory.v2` (adds `meta`, `config`, `daily_journal`).
- Stats may include fee/trade counters: `buy_trades`, `sell_trades`, `total_fees_paid`.

### GET /api/replay/runtime/status

Wrapped replay runtime status payload.

- Includes `running`, `speed`, `cursor_index`, timeline size, current replay timestamp, and trading-day boundary fields (`trading_day`, `day_index`, `day_count`, `is_day_start`, `is_day_end`).

### POST /api/replay/runtime/control

Replay runtime control endpoint for market playback.

Request body:

```json
{ "action": "set_speed", "speed": 60 }
```

Supported `action` values:

- `pause`
- `resume`
- `step` (optional `bars`, default `1`)
- `set_speed` (requires `speed`)
- `set_cursor` (requires `cursor_index`)

### POST /api/dev/factory-reset

Dev-only hard reset endpoint for repeated replay test runs.

- Pauses replay and agent runtime
- Resets replay cursor (default `0`, optional `use_warmup=true`)
- Clears in-memory agent decision counters/history
- Reinitializes `data/agent-memory/*.json` to defaults

### GET /api/equity-history?trader_id=&hours=

Wrapped list of equity points used by room equity curve.

### POST /api/equity-history-batch

Wrapped object keyed by `trader_id`, used by leaderboard comparison chart.

### GET /api/positions/history?trader_id=&limit=

Wrapped `PositionHistoryResponse` payload.

### GET /api/symbols?exchange=sim-cn

Raw symbol list used in room chart selector (historical compatibility path).

This endpoint currently does **not** use the `{ success, data }` wrapper.

Example:

```json
{
  "symbols": [
    { "symbol": "600519.SH", "name": "Kweichow Moutai", "category": "stock" }
  ]
}
```

### GET /api/market/frames?symbol=&interval=&limit=

Canonical market-data endpoint.

Returns `market.frames.v1` where each frame is `market.bar.v1`.

This is the standard format for both mock and real data.

Frontend demo behavior:

- If replay data exists under `onlytrade-web/public/replay/cn-a/latest/frames.1m.json`, static mode serves replay-backed frames for `interval=1m`.
- Add `source=mock` query to force generated mock frames.

Example:

```json
{
  "success": true,
  "data": {
    "schema_version": "market.frames.v1",
    "market": "CN-A",
    "mode": "mock",
    "provider": "onlytrade-mock-feed",
    "frames": [
      {
        "schema_version": "market.bar.v1",
        "market": "CN-A",
        "mode": "mock",
        "provider": "onlytrade-mock-feed",
        "feed": "bars",
        "seq": 1,
        "event_ts_ms": 1768022100000,
        "ingest_ts_ms": 1768022100123,
        "instrument": {
          "symbol": "600519.SH",
          "exchange": "SSE",
          "timezone": "Asia/Shanghai",
          "currency": "CNY"
        },
        "interval": "1m",
        "window": {
          "start_ts_ms": 1768022040000,
          "end_ts_ms": 1768022100000,
          "trading_day": "2026-02-11"
        },
        "session": {
          "phase": "continuous_am",
          "is_halt": false,
          "is_partial": false
        },
        "bar": {
          "open": 1510.2,
          "high": 1512.8,
          "low": 1509.6,
          "close": 1511.9,
          "volume_shares": 8200,
          "turnover_cny": 12397580,
          "vwap": 1511.9
        }
      }
    ]
  }
}
```

### GET /api/market/stream?symbols=&interval=&limit=

Server-Sent Events endpoint for near-realtime frame updates.

- Query params:
  - `symbols`: comma-separated symbols (`600519.SH,300750.SZ`)
  - `interval`: bar interval (`1m`, `5m`, ...)
  - `limit`: optional lookback for upstream fetch before selecting latest frame

Event types:

- `ready`: connection metadata
- `frames`: payload is `market.frames.v1` envelope containing latest frame updates
- `error`: transient stream-side fetch/emit errors

Notes:

- Stream payload uses the same canonical frame schema as `/api/market/frames`.
- In `MARKET_PROVIDER=real`, stream reads from upstream proxy and falls back to replay/mock on upstream failure.

### GET /api/agent/market-context?symbol=&intraday_interval=&intraday_limit=&daily_limit=&trader_id=

Compact context payload for agent decision loops.

- Returns intraday bars + daily bars in canonical `market.bar.v1` shape.
- Includes precomputed feature snapshots (returns, ATR, SMA, RSI, volume ratio, range).
- `trader_id` is optional; used to include position/account-derived state.
- Intended cadence: ingest every bar, decision every 3-5 bars.

Reference: `docs/AGENT_MARKET_CONTEXT.md`

### GET /api/klines?symbol=&interval=&limit=&exchange=

Legacy compatibility endpoint for current chart components.

Must be derived from canonical `market.bar.v1` frames (not a separate data source).

### GET /api/orders?trader_id=&symbol=&status=&limit=

Wrapped list of filled orders for chart markers (optional but recommended for complete room view).

### GET /api/open-orders?trader_id=&symbol=

Wrapped list of pending orders for chart price lines (optional for MVP demo realism).

### POST /api/rooms/:room_id/ask (planned)

Request:

```json
{ "user_id": "u_demo", "message": "Why reduce 600519.SH today?" }
```

Response (wrapped):

```json
{ "success": true, "data": { "event_id": "evt_123", "accepted": true } }
```

### POST /api/rooms/:room_id/fuel (planned)

Request:

```json
{ "user_id": "u_demo", "points": 30 }
```

Response (wrapped):

```json
{ "success": true, "data": { "event_id": "evt_124", "accepted": true } }
```

### GET /api/rooms/:room_id/events (planned)

Returns ordered room interaction events (ask/fuel/system), for replacing frontend-local event mocks.

### GET /api/statistics?trader_id=

Wrapped `Statistics` payload.

Fixture: `onlytrade-web/tests/fixtures/api_statistics.json`
