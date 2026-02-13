# AKShare Live Data Contract

## Purpose

Define the file contracts used by the AKShare collector/converter pipeline and the runtime-api live-file provider.

Compatibility note: `mock-api/` may exist as a shim entrypoint on some VMs, but the real code lives in `runtime-api/`.

## Raw minute stream

- Path: `data/live/akshare/raw_minute.jsonl`
- Format: one JSON object per line
- Producer: `scripts/akshare/collector.py`

Example row:

```json
{
  "symbol_code": "600519",
  "time": "2026-02-12 14:58:00",
  "open": 1486.6,
  "close": 1487.1,
  "high": 1488.0,
  "low": 1485.9,
  "volume_lot": 120,
  "amount_cny": 17845200.0,
  "avg_price": 1487.1,
  "source": "akshare.stock_zh_a_hist_min_em",
  "ingest_ts": "2026-02-12T14:58:10"
}
```

## Raw quote snapshot

- Path: `data/live/akshare/raw_quotes.json`
- Format: full JSON snapshot
- Producer: `scripts/akshare/collector.py`

Schema:

```json
{
  "schema_version": "akshare.raw.quotes.v1",
  "generated_at": "ISO-8601",
  "rows": [],
  "errors": []
}
```

## Canonical frames output

- Path: `data/live/onlytrade/frames.1m.json`
- Format: `market.frames.v1`
- Producer: `scripts/akshare/converter.py`
- Consumer: `runtime-api/src/liveFileFrameProvider.mjs`

Schema:

```json
{
  "schema_version": "market.frames.v1",
  "market": "CN-A",
  "mode": "real",
  "provider": "akshare",
  "frames": [
    {
      "schema_version": "market.bar.v1",
      "instrument": { "symbol": "600519.SH" },
      "interval": "1m",
      "window": { "start_ts_ms": 0, "end_ts_ms": 0, "trading_day": "YYYY-MM-DD" },
      "bar": { "open": 0, "high": 0, "low": 0, "close": 0, "volume_shares": 0, "turnover_cny": 0, "vwap": 0 }
    }
  ]
}
```

## Runtime mode contract

- `RUNTIME_DATA_MODE=replay`
  - Existing replay engine drives agent cadence by replay bars.
- `RUNTIME_DATA_MODE=live_file`
  - Agents run by runtime cycle timer.
  - `marketDataService` reads 1m frames from canonical file via live-file provider.

## Safety requirements

- Writers must use atomic file replacement (`*.tmp` + rename).
- Consumer must keep last good cache when parse/read fails.
- Stale data must be detectable from provider status (`stale=true`).
