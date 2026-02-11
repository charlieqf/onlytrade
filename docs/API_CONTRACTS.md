# API Contracts (MVP)

This project follows a contract-first approach.

- Contracts are defined here.
- Example payloads live in `onlytrade-web/tests/fixtures/`.
- Backend should serve these shapes (fixtures first, then real implementations behind the same contracts).

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

### GET /api/equity-history?trader_id=&hours=

Wrapped list of equity points used by room equity curve.

### POST /api/equity-history-batch

Wrapped object keyed by `trader_id`, used by leaderboard comparison chart.

### GET /api/positions/history?trader_id=&limit=

Wrapped `PositionHistoryResponse` payload.

### GET /api/symbols?exchange=sim-cn

Wrapped symbol list used in room chart selector.

Example:

```json
{
  "success": true,
  "data": {
    "symbols": [
      { "symbol": "600519.SH", "name": "Kweichow Moutai", "category": "stock" }
    ]
  }
}
```

### GET /api/klines?symbol=&interval=&limit=&exchange=

Wrapped OHLCV list used by room kline chart.

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
