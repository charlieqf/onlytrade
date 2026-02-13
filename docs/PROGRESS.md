# Progress

This file is the living progress tracker. Update it as work lands.

## Current Status

- Repo bootstrapped with AGPL-3.0 license and third-party notices
- Frontend forked into `onlytrade-web/` with `/lobby`, `/room`, `/leaderboard`
- Frontend unit tests pass (Vitest)
- Static demo mode implemented in frontend (`VITE_DEMO_MODE` defaults to static)
- Milestone 2 started: mock-live demo mode scaffolded via `VITE_DEMO_MODE=mock-live`
- Core frontend pass complete: app shell now centered on `/lobby`, `/room`, `/leaderboard` with Ask/Fuel + simulation-rule UI
- UI-complete assessment added: `docs/UI_COMPLETE_CHECKLIST.md`
- Realtime data proxy scaffolded in `runtime-api/` with adapter mode switch (`MARKET_PROVIDER`), canonical frame normalization, and SSE endpoint (`/api/market/stream`)
- Added 90-day daily (`1d`) history updater for agent context warmup (`scripts/update-cn-daily-history.mjs`)
- Added agent context endpoint + feature snapshots (`/api/agent/market-context`) backed by intraday + 90-day daily bars
- Added mock in-memory agent decision loop feeding `/api/decisions/latest` on a configurable cycle
- Added runtime control/status APIs for demo operations (`/api/agent/runtime/status`, `/api/agent/runtime/control`)
- Added room-side runtime control UI (pause/resume/step/cycle-ms) wired to runtime control APIs
- Added replay clock engine for `1m` bars (default `60x`) with replay runtime status/control APIs
- Symbol API now returns Chinese A-share names for key demo symbols (e.g. 贵州茅台/宁德时代)
- Switched agent triggering to replay-event driven cadence (decision every N replay bars) for production-style pattern
- Replay pack tooling now builds 3-trading-day `1m` bundles by default for multi-day competitions
- Replay runtime now exposes day-boundary awareness (`day_index`, `is_day_start`, `is_day_end`) for day lifecycle handling
- Added persistent per-trader long-term memory snapshots in JSON (`data/agent-memory/*.json`)
- Dashboard runtime panel now shows replay day progress + per-trader memory stats (`/api/replay/runtime/status`, `/api/agent/memory`)
- Competition/account drift now follows replay cursor progression (freezes when replay pauses, advances across replay days)
- Agent trigger cadence default updated to 10 replay bars (10-minute market-time reasoning cadence at `1m` bars)
- Added optional OpenAI `gpt-4o-mini` decision path with automatic fallback to heuristic rules
- Agent memory JSON upgraded to `agent.memory.v2` with meta/config/daily journal sections
- Runtime API now auto-loads env from `runtime-api/.env.local` (or `.env`) with compatibility fallback to `mock-api/.env.local`
- Added dev `factory-reset` endpoint + runtime reset hooks for repeatable full replay test reruns
- Added per-trade commission deduction (buy/sell) with fee tracking in agent memory stats
- Hardened LLM decision parsing with strict JSON shape validation + fallback
- Upgraded LLM response contract to strict `decisions[0]` JSON schema and added dev token-saver prompt/context mode
- Added persistent kill-switch for emergency stop of all agent decisions (blocks LLM calls until deactivated)
- Persistence strategy confirmed: JSON-first for near-term ops; DB deferred unless scaling requires it
- Rebrand landed: OpenTrade naming in UI/docs/contracts
- Live ops improvements:
  - Live-file session gating (auto pause/resume by market hours)
  - Daily decision persistence to JSONL (keeps today's Thought & Actions visible until local midnight)
  - Trade event logging enhanced with post-trade cash/position snapshots
  - Position history UI polls without flashing; fee/after columns backfilled for seeded events
- Multi-market foundation (single backend):
  - Market spec and session rules for `sim-cn` (Shanghai) and `sim-us` (New York, weekday-only regular session)
  - Separate CN/US live-file providers (`LIVE_FRAMES_PATH_CN`, `LIVE_FRAMES_PATH_US`)
  - US ingestion scripts added (Alpaca IEX 1m+1d -> canonical frames file)
  - Two US tech agents added (`us_001`, `us_002`) with portrait avatars

## Demo Milestones

- [x] Milestone 1: Static demo (content complete, static data)
- [x] Milestone 2: Mock-live demo (app + agents look live with prepared mock streams)
- [ ] Milestone 3: Real `gpt-4o-mini` agent logic on mock stock data

Note: the current codebase now supports real-time/live-file market mode and multi-market agent gating. Milestones remain useful for demo framing, but live ops have started to supersede the earlier mock-live-only track.

Reference: `docs/DEMO_MILESTONES.md`

## MVP Checklist

### Product Decisions
- [x] Virtual-only (no betting, no payouts)
- [x] Market: Mainland China A-shares
- [x] Universe: HS300

### Frontend
- [x] Create `onlytrade-web/` from nofx
- [x] Add lobby page (`/lobby`)
- [x] Rebrand header/footer + source link
- [x] Remove/retire crypto-first routes from app shell/nav (`/lobby`, `/room`, `/leaderboard` focused)
- [ ] Replace any remaining NOFX-specific copy in non-core legacy pages (landing/FAQ files)
- [x] Room UI: rename labels to A-share terms (shares, CNY, CN-SIM)
- [x] Add frontend-only interaction panel (Ask/Fuel) in room
- [x] Add visible simulation rules card in room and leaderboard
- [x] Core demo UX near-final (lobby/room/leaderboard)
- [x] Core frontend marked UI-complete for frontend-only scope (see `docs/UI_COMPLETE_CHECKLIST.md`)

### Backend
- [x] Define API contracts (payload schemas + sample JSON)
- [x] Expand contract doc to match current frontend data dependencies
- [x] Define unified market-data schema for mock + real (`market.bar.v1`)
- [x] Document A-share realtime retrieval architecture (`docs/A_SHARE_REALTIME_RETRIEVAL.md`)
- [x] Prepare replay pack tooling for yesterday CN-A bars (`scripts/fetch-cn-replay.mjs`)
- [x] Prepare rolling 90-day `1d` CN-A history and daily append workflow (`scripts/update-cn-daily-history.mjs`)
- [x] Minimal API service returning fixtures/replay (`runtime-api/`, with `mock-api/` shim)
- [x] Realtime stock data proxy scaffold (upstream adapter + fallback + canonical normalization + SSE)
- [ ] Real A-share OHLCV provider (licensed)
- [ ] Trade simulator (T+1, lot size, fees)
- [ ] Agent runtime (1-3 personas) emitting actions + thought summaries
- [x] Agent-ready market context payload contract and runtime endpoint (`docs/AGENT_MARKET_CONTEXT.md`, `runtime-api`)

### Testing
- [x] Unit tests (Vitest) in `onlytrade-web/src/**/*.test.*`
- [x] Unit tests for market proxy normalization/dedupe/fallback in `runtime-api/test/marketProxy.test.mjs`
- [x] Add integration/E2E structure (Playwright recommended)
- [ ] Add one smoke test: lobby renders and navigation works

### Release
- [ ] Add CI workflow (lint + test + build)
- [ ] Document deployment target (Vercel vs self-host)
