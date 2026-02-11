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

### GET /api/statistics?trader_id=

Wrapped `Statistics` payload.

Fixture: `onlytrade-web/tests/fixtures/api_statistics.json`
