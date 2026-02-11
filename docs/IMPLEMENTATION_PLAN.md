# OnlyTrade Implementation Plan (MVP)

Goal: ship a virtual-only A-share experience where users can enter "rooms" to watch AI traders run a simulated portfolio on real market data, with a readable thought/action feed.

## Approach

Contract-first, executed as UI-driven vertical slices:

- Contract-first: define and version the minimal API payloads the UI needs.
- Fixture-backed: implement a thin backend that serves deterministic fixtures matching the contracts.
- Replace behind contracts: swap fixtures out for real implementations (market data, simulator, agents) one endpoint at a time without changing the UI.

Constraints locked in:
- Virtual-only (no betting, no payouts, no revenue share)
- Market focus: Mainland China A-shares, HS300 universe
- Entertainment/education framing (not investment advice)

## Phase 0 - Contracts + Fixtures (1-2 days)

1) Define MVP contracts (frontend/backend boundary)
- Define response payloads for:
  - `GET /api/config`
  - `GET /api/competition` (leaderboard)
  - `GET /api/traders` (public trader list)
  - `GET /api/status?trader_id=`
  - `GET /api/account?trader_id=`
  - `GET /api/positions?trader_id=`
  - `GET /api/decisions/latest?trader_id=&limit=`
  - `GET /api/statistics?trader_id=`

2) Create fixture JSON that matches contracts
- Put fixtures in a single place and treat them as "golden" payloads.
- Use them for:
  - backend fixture responses
  - frontend story/demo data (optional)
  - future integration/E2E tests

3) Document simulation rules (must be transparent)
- Fill price (e.g. next-bar open)
- Fees/taxes (commission + stamp duty assumptions)
- T+1 and lot size constraints (A-share realism)

Deliverable:
- `docs/API_CONTRACTS.md`
- `docs/SIMULATION_RULES.md`
- `onlytrade-web/tests/fixtures/` populated with sample payloads

## Phase 1 - Thin Backend Serving Fixtures (2-4 days)

Goal: provide stable mock-to-real API endpoints that let the UI show lobby/room/leaderboard without hacks.

1) Create a minimal API service
- Implement `GET /api/config` (beta_mode, registration_enabled)
- Implement `GET /api/traders` and `GET /api/competition` using static fixtures first
- Implement the per-trader endpoints (`status`, `account`, `positions`, `decisions/latest`, `statistics`) using fixtures

2) Add a data model
- Traders (id, name, persona, model)
- Decisions / thought log events
- Portfolio snapshots / positions

Deliverable:
- UI runs end-to-end against your API with deterministic fixture data.

## Phase 2 - UI-Driven Vertical Slices (ongoing)

Goal: iterate by page, keeping the contracts stable.

Slice A: Lobby
- Contracts: `/api/traders`, `/api/competition`
- UI: `onlytrade-web/src/pages/LobbyPage.tsx`

Slice B: Room
- Contracts: `/api/status`, `/api/account`, `/api/positions`, `/api/decisions/latest`, `/api/statistics`
- UI: `onlytrade-web/src/pages/TraderDashboardPage.tsx`

Slice C: Leaderboard
- Contracts: `/api/competition`
- UI: `onlytrade-web/src/components/CompetitionPage.tsx`

## Phase 3 - Market Data + Trade Simulator (3-7 days)

Goal: drive the simulator from real A-share OHLCV (1m/5m bars) with clear licensing.

1) Pick a licensed A-share data source
- MVP-friendly: start with 5m bars
- Avoid scraping sources for a public release

2) Implement ingestion + caching
- Fetch bars for HS300 constituents
- Cache by symbol + timeframe
- Ensure trading session boundaries (CN hours)

3) Implement portfolio simulator
- Enforce T+1 and 100-share lots
- Apply slippage + fees
- Output consistent positions + NAV + equity curve

Deliverable:
- Leaderboard is computed from simulator outputs, not hard-coded.

## Phase 4 - Agent Runtime (5-10 days)

Goal: run 1-3 agents that periodically emit a structured "action" and a human-readable "thought".

1) Agent loop
- Event-driven triggers + heartbeat cadence (e.g. 10s)
- Backpressure: aggregate to 1m/5m bars, avoid tick-level streaming

2) Output contracts
- `AgentAction`: BUY/SELL/HOLD with qty + confidence
- `ThoughtLogEvent`: short readable rationale (no sensitive chain-of-thought policy violations; keep it to a narrative summary)

3) Persistence
- Store events and portfolio snapshots in Postgres (recommended)

Deliverable:
- Room feed updates over polling (initial) then SSE/WebSocket (later).

## Phase 5 - Frontend Productization (3-7 days)

Goal: reshape the nofx-derived UI into OnlyTrade pages while keeping the chart quality.

1) Keep these pages
- `/lobby` (LobbyPage)
- `/room` (TraderDashboardPage)
- `/leaderboard` (CompetitionPage)

2) Gradually remove crypto-specific UI
- Exchange configuration, strategy builder, debate arena
- Replace symbol UX for A-share format (e.g. 600519.SH)

3) Improve room UX for A-shares
- Kline defaults: 1m/5m
- Trade markers: virtual trades
- Thought log: pinned newest first + filters

Deliverable:
- OnlyTrade UI feels consistent and domain-correct for A-shares.

## Definition of Done (MVP)

- Lobby shows active traders with current virtual PnL and last thought snippet
- Room shows Kline + recent decisions + positions (virtual)
- Leaderboard ranks traders by return + drawdown over fixed windows
- Clear disclaimer and simulation rules are visible in-product
- Unit tests pass; basic E2E smoke test exists
