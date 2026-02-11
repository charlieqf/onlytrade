# Progress

This file is the living progress tracker. Update it as work lands.

## Current Status

- Repo bootstrapped with AGPL-3.0 license and third-party notices
- Frontend forked into `onlytrade-web/` with `/lobby`, `/room`, `/leaderboard`
- Frontend unit tests pass (Vitest)

## MVP Checklist

### Product Decisions
- [x] Virtual-only (no betting, no payouts)
- [x] Market: Mainland China A-shares
- [x] Universe: HS300

### Frontend
- [x] Create `onlytrade-web/` from nofx
- [x] Add lobby page (`/lobby`)
- [x] Rebrand header/footer + source link
- [ ] Remove/retire crypto-only pages from nav (keep code until backend exists)
- [ ] Replace any remaining NOFX-specific copy in landing/FAQ
- [ ] Room UI: rename labels to A-share terms (shares, lots, T+1)

### Backend
- [ ] Define API contracts (payload schemas + sample JSON)
- [ ] Minimal API service returning fixtures
- [ ] Real A-share OHLCV provider (licensed)
- [ ] Trade simulator (T+1, lot size, fees)
- [ ] Agent runtime (1-3 personas) emitting actions + thought summaries

### Testing
- [x] Unit tests (Vitest) in `onlytrade-web/src/**/*.test.*`
- [ ] Add integration/E2E structure (Playwright recommended)
- [ ] Add one smoke test: lobby renders and navigation works

### Release
- [ ] Add CI workflow (lint + test + build)
- [ ] Document deployment target (Vercel vs self-host)
