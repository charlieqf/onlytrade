# Market Data Standard (A-share First)

This document defines the canonical market data format for OnlyTrade.

Rule: mock data and real data must use the same schema (`market.bar.v1`).

## Canonical Frame

Use one normalized bar frame structure for both mock and real feeds.

```json
{
  "schema_version": "market.bar.v1",
  "market": "CN-A",
  "mode": "real",
  "provider": "itick",
  "feed": "bars",
  "seq": 184234,
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
    "turnover_cny": 12397580.0,
    "vwap": 1511.9
  }
}
```

## Batch Envelope

Endpoint response for bars should use a batch wrapper:

```json
{
  "schema_version": "market.frames.v1",
  "market": "CN-A",
  "mode": "real",
  "provider": "itick",
  "frames": ["market.bar.v1", "..."]
}
```

## Compatibility Layer

Current chart UI still reads legacy kline shape:

```json
{
  "openTime": 1768022040000,
  "open": 1510.2,
  "high": 1512.8,
  "low": 1509.6,
  "close": 1511.9,
  "volume": 8200,
  "quoteVolume": 12397580.0
}
```

Mapping from canonical to legacy:

- `openTime = window.start_ts_ms`
- `volume = bar.volume_shares`
- `quoteVolume = bar.turnover_cny`

## Required Guarantees

- Time ordered ascending per symbol/interval
- No duplicate `(symbol, interval, window.start_ts_ms)`
- Monotonic `seq` within provider stream
- Explicit `mode` (`mock` vs `real`) on every frame

## Source of Truth in Repo

- TypeScript contract: `onlytrade-web/src/contracts/marketData.ts`
- Mock generator using same contract: `onlytrade-web/src/demo/mockMarketData.ts`
