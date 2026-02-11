# A-share Real-time Retrieval Design

Focus market: Mainland China A-shares (HS300 first).

## Goal

Provide near-real-time bars to agents and UI using one normalized contract (`market.bar.v1`) regardless of provider.

## Data Flow

1. Provider Adapter (iTick/Tushare/etc.)
2. Normalizer (provider payload -> `market.bar.v1`)
3. Dedup/Ordering guard (`symbol + interval + window.start_ts_ms`)
4. Hot store (Redis stream/cache) + durable store (Postgres)
5. API/stream fan-out to frontend and agent runtime

## Adapter Interface

Each provider adapter implements the same interface:

```ts
interface CnMarketAdapter {
  name: string
  mode: 'real' | 'mock'
  connect(): Promise<void>
  subscribeBars(symbols: string[], interval: string): AsyncIterable<unknown>
  fetchRecentBars(symbol: string, interval: string, limit: number): Promise<unknown[]>
  close(): Promise<void>
}
```

Normalizer function:

```ts
normalizeBar(raw: unknown, context: { provider: string; symbol: string; interval: string }): MarketBarFrameV1
```

## Session Rules (CN Market)

- Timezone: `Asia/Shanghai`
- Trading sessions:
  - 09:30-11:30 (continuous_am)
  - 13:00-15:00 (continuous_pm)
- Lunch break marked as `session.phase = lunch_break`
- Mark partial bars with `session.is_partial = true`

## Freshness and Latency

Suggested SLOs (MVP):

- Provider -> normalized frame: P95 < 1200ms
- Normalized frame -> API availability: P95 < 500ms
- Total market move to UI update: 2-5s acceptable for commentary product

## API Surface for Realtime

- `GET /api/market/frames?symbol=600519.SH&interval=1m&limit=500`
  - returns `market.frames.v1`
- Optional stream endpoint:
  - `GET /api/market/stream?symbols=600519.SH,300750.SZ&interval=1m` (SSE)

Legacy compatibility:

- Keep `/api/klines` for current chart during transition
- Generate `/api/klines` from `market.bar.v1` adapter mapping (not separate data source)

## Provider Strategy (Phased)

Phase A (internal/demo):

- Mock adapter using deterministic replay data (`mode=mock`)

Phase B (public MVP):

- Real provider adapter (recommended WebSocket-capable source)
- Same normalizer and storage pipeline

## Operational Checks

- Gap detection: missing bars by interval windows
- Duplicate detection by unique key
- Provider heartbeat alarm (no frames for N seconds)
- Daily reconciliation sample against reference close prices
