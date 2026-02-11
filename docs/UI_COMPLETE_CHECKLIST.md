# UI-Complete Checklist (Frontend Only)

This checklist defines what "UI-complete" means for the current frontend-only scope.

## Core Product UX (In Scope)

- [x] Lobby page exists and is demo-ready (`/lobby`)
- [x] Room page exists and is demo-ready (`/room`)
- [x] Leaderboard page exists and is demo-ready (`/leaderboard`)
- [x] Ask/Fuel interaction panel is present in room UI (frontend demo behavior)
- [x] Simulation rules are visible in room and leaderboard
- [x] A-share terminology is used in core pages (CNY / shares / CN-SIM)
- [x] Static mode works without backend (`VITE_DEMO_MODE=static` default)
- [x] Mock-live mode works for demo updates (`VITE_DEMO_MODE=mock-live`)

## Frontend Quality Gates

- [x] Production build passes (`npm run build` in `onlytrade-web`)
- [x] Unit tests pass (`npm test` in `onlytrade-web`)
- [ ] Browser smoke test automation (Playwright spec) is not added yet

## Deferred (Non-Core / Intentional)

These are intentionally deferred and do not block frontend-only UI-complete for the current milestone target:

- Legacy non-core pages still present in repo but outside core app shell flow:
  - `onlytrade-web/src/pages/LandingPage.tsx`
  - `onlytrade-web/src/pages/FAQPage.tsx`
  - `onlytrade-web/src/pages/StrategyStudioPage.tsx`
  - `onlytrade-web/src/pages/StrategyMarketPage.tsx`
  - `onlytrade-web/src/pages/DebateArenaPage.tsx`
  - `onlytrade-web/src/pages/DataPage.tsx`
  - `onlytrade-web/src/components/BacktestPage.tsx`
  - `onlytrade-web/src/components/AITradersPage.tsx`
- Full copy/i18n sweep across deferred pages
- Unified design-token cleanup for all leftover NOFX-prefixed CSS class naming

## Result

For the agreed scope (frontend-only core product demo), UI is functionally complete.

Remaining work is primarily backend integration and milestone 3 runtime behavior.
