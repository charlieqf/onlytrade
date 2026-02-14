# Market/Sector Overview + News Adapters (CN-A + US)

## Problem

Per-trade context must include **overall market regime** (and sector rotation), not only the traded symbol. This is required for:

- Better decision quality (avoid trading against broad tape/sector headwinds)
- Streamer-style commentary (what makes the agent feel like a real person talking)

Constraints:

- LLM inputs must stay **small** (no full bar series / no large context dumps).
- The system must be **auditable**: reviewers can confirm the LLM received **correct, fresh, complete** data.

## Goals

- Provide a compact `market_overview` snapshot for **every** agent cycle.
- Support both markets:
  - CN-A via AKShare
  - US via Alpaca
- Single canonical contract across markets.
- Reliable fallback:
  - If real benchmark/sector overview is unavailable, compute `proxy_watchlist` and mark **WARN** (not ERROR).

## Non-goals (v1)

- Deep macro calendars / earnings transcripts.
- Full-market breadth accuracy (we accept proxying when needed).
- Feeding raw bars into the LLM.

## Canonical Contracts

### 1) `market.overview.v1` (minute-level snapshot)

File-based snapshot refreshed approximately once per minute.

- CN-A: `data/live/onlytrade/market_overview.cn-a.json`
- US: `data/live/onlytrade/market_overview.us.json`

Design principles:

- Store **summary features + provenance**, not raw bar arrays.
- Make it easy to validate freshness and completeness.

Conceptual shape:

```json
{
  "schema_version": "market.overview.v1",
  "market": "US",
  "mode": "real",
  "provider": "alpaca-iex",
  "source_kind": "benchmark",
  "generated_at_ts_ms": 1739568000000,
  "benchmarks": [
    {
      "symbol": "QQQ",
      "name": "QQQ",
      "as_of_ts_ms": 1739567980000,
      "feature_snapshot": { "ret_5": 0.0012, "ret_20": 0.0041 },
      "meta": { "interval": "1m", "frames_count": 60, "last_event_ts_ms": 1739567980000 }
    }
  ],
  "sectors": [
    {
      "symbol": "XLK",
      "name": "Technology",
      "rank": 1,
      "as_of_ts_ms": 1739567980000,
      "feature_snapshot": { "ret_5": 0.0018, "ret_20": 0.0062 },
      "meta": { "interval": "1m", "frames_count": 60, "last_event_ts_ms": 1739567980000 }
    }
  ],
  "breadth": { "advancers": null, "decliners": null, "unchanged": null },
  "sources": [],
  "errors": []
}
```

`source_kind` values:

- `benchmark`: derived from canonical benchmark + sector proxies (preferred)
- `proxy_watchlist`: derived from the agent universe / watchlist (fallback, should trigger WARN)

Minimum required fields (v1):

- `generated_at_ts_ms`
- `source_kind`
- `benchmarks[]` with at least 1 entry
- each entry includes `feature_snapshot.ret_5` and `feature_snapshot.ret_20` (nullable if explicitly missing)

### 2) `news.digest.v1` (headline-only digest)

Daily digest file built pre-open, optionally refreshed during market hours.

- CN-A: `data/live/onlytrade/news_digest.cn-a.json`
- US: `data/live/onlytrade/news_digest.us.json`

Headline-only (v1) shape:

```json
{
  "schema_version": "news.digest.v1",
  "market": "CN-A",
  "provider": "akshare-or-empty",
  "generated_at_ts_ms": 1739568000000,
  "headlines": [
    { "ts_ms": 1739567000000, "source": "akshare", "title": "Title only", "symbols": [], "url": "" }
  ],
  "errors": []
}
```

Rules:

- Agents may quote **titles only** in streamer messages.
- Do not expand news into invented details.
- If no provider is available, write an empty digest (valid JSON with `headlines: []`).

## Data Sources (Simplest + Reliable)

### US market + sectors (Alpaca)

Use ETFs as stable proxies:

- Benchmarks: `SPY`, `QQQ`, `IWM` (optional `DIA`)
- Sector proxies (11): `XLC, XLY, XLP, XLE, XLF, XLV, XLI, XLB, XLK, XLU, XLRE`

Fetch:

- `1m` bars: needed for `ret_5` / `ret_20`
- optional `1d` bars (later) for day context

Compute:

- `ret_5 = close[-1]/close[-6] - 1`
- `ret_20 = close[-1]/close[-21] - 1`

### CN-A market + sectors (AKShare)

Use:

- Major index snapshots (best-effort via reliable AKShare endpoints)
- Industry/board heatmap snapshots (top/bottom N)

Compute ret_5/ret_20 for sectors by keeping a small rolling history of snapshots (avoid per-sector 1m bars).

## Runtime Integration

### Live-file overview provider (Node)

Implement a reader similar to existing live-frame providers:

- Atomic reads
- Keep last-good cache on parse errors
- Stale detection

Default thresholds (1m cadence):

- WARN stale: > 150s
- ERROR stale: > 330s

Env:

- `LIVE_MARKET_OVERVIEW_PATH_US`
- `LIVE_MARKET_OVERVIEW_PATH_CN`
- `MARKET_OVERVIEW_STALE_WARN_MS`
- `MARKET_OVERVIEW_STALE_ERROR_MS`

### Fallback: `proxy_watchlist` (WARN)

If benchmark overview is missing/stale/unparseable:

- Build proxy from union of `stock_pool` (per exchange) using existing bar data.
- Mark `source_kind="proxy_watchlist"`.
- This should trigger WARN in readiness/audit, but still allow normal operation.

## Acceptance Criteria

- Every agent cycle has `market_overview`:
  - `benchmark` when available; otherwise `proxy_watchlist` with WARN.
- Freshness is visible (`generated_at_ts_ms`) and validated.
- US overview is built from Alpaca only.
- CN-A overview is built from AKShare only.
- News digest exists daily (valid even if empty) and is safe to quote.
