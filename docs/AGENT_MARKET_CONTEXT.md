# Agent Market Context (Draft)

This document defines a minimal, agent-ready data contract for A-share trading decisions.

Goal: keep agent prompts small and deterministic by giving each decision step both recent intraday bars and medium-term daily context.

## Why This Contract

- Realtime-only data is insufficient for trend/regime understanding.
- Full raw history every tick is too large and expensive for LLM reasoning.
- A compact, pre-shaped payload enables reliable and repeatable decisions.

## Recommended Inputs per Decision

- Intraday window: latest 120-240 bars (`1m` or `5m`) for execution timing.
- Daily window: latest 90 bars (`1d`) for trend, volatility, and support/resistance context.
- Position/risk state: current holdings, cash, constraints (T+1, lot size).

## Contract: `agent.market_context.v1`

```json
{
  "schema_version": "agent.market_context.v1",
  "as_of_ts_ms": 1768172400000,
  "symbol": "600519.SH",
  "market": "CN-A",
  "constraints": {
    "lot_size": 100,
    "t_plus_one": true,
    "currency": "CNY"
  },
  "intraday": {
    "interval": "1m",
    "frames": [{ "schema_version": "market.bar.v1" }],
    "feature_snapshot": {
      "ret_5": 0.0032,
      "ret_20": 0.0111,
      "atr_14": 12.4,
      "vol_ratio_20": 1.38
    }
  },
  "daily": {
    "interval": "1d",
    "frames": [{ "schema_version": "market.bar.v1" }],
    "feature_snapshot": {
      "sma_20": 1534.6,
      "sma_60": 1488.1,
      "rsi_14": 57.2,
      "range_20d_pct": 0.146
    }
  },
  "position_state": {
    "shares": 300,
    "avg_cost": 1508.2,
    "unrealized_pnl": 1120.0,
    "cash_cny": 81320.5,
    "max_gross_exposure_pct": 1.0
  }
}
```

## Proposed API Shape

- `GET /api/agent/market-context?symbol=600519.SH&intraday_interval=1m&intraday_limit=180&daily_limit=90`
- Returns one `agent.market_context.v1` payload.
- Server computes and includes `feature_snapshot` fields so agents do not recompute indicators in-prompt.

Current status:

- Implemented in `runtime-api` for development/demo flow.

## Decision Cadence

- Data ingest: each replay/realtime bar.
- Agent decision loop: every 3-5 intraday bars (or event-triggered).
- Risk checks: every bar (cheap deterministic rules).

## Replay + Daily History Coupling

- Intraday replay stream drives the decision clock.
- Daily context uses rolling 90-day `1d` history data.
- Keep both in canonical `market.bar.v1` format to avoid dual parsers.
