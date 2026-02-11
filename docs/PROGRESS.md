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

## Demo Milestones

- [x] Milestone 1: Static demo (content complete, static data)
- [x] Milestone 2: Mock-live demo (app + agents look live with prepared mock streams)
- [ ] Milestone 3: Real `gpt-4o-mini` agent logic on mock stock data

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
- [ ] Minimal API service returning fixtures
- [ ] Real A-share OHLCV provider (licensed)
- [ ] Trade simulator (T+1, lot size, fees)
- [ ] Agent runtime (1-3 personas) emitting actions + thought summaries

### Testing
- [x] Unit tests (Vitest) in `onlytrade-web/src/**/*.test.*`
- [x] Add integration/E2E structure (Playwright recommended)
- [ ] Add one smoke test: lobby renders and navigation works

### Release
- [ ] Add CI workflow (lint + test + build)
- [ ] Document deployment target (Vercel vs self-host)
