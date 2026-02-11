# Testing

## Current State

The repository currently has frontend unit tests only.

### Unit Tests (Vitest)

- Location: `onlytrade-web/src/**/*.test.ts` and `onlytrade-web/src/**/*.test.tsx`
- Runner: Vitest
- Setup file: `onlytrade-web/src/test/setup.ts`

Run:

```bash
cd onlytrade-web
npm test
```

### What’s covered today

- UI/components unit tests (examples: RegisterPage, CompetitionPage)
- Small library-level tests (examples: apiGuard, registrationToggle)

## Integration / E2E Tests (Not yet set up)

Recommended approach for this project:

- E2E runner: Playwright
- Folder structure:
  - `onlytrade-web/tests/e2e/` (test specs)
  - `onlytrade-web/tests/fixtures/` (mock API payloads)

Suggested first E2E tests:

1) Lobby smoke
- Visit `/lobby`
- Assert header renders (OnlyTrade)
- Stub `/api/competition` to deterministic fixture

2) Room smoke
- Visit `/room?trader=...`
- Stub `/api/*` endpoints used by room
- Assert chart container + decision feed exist

## CI Recommendation

At minimum, run:

```bash
cd onlytrade-web
npm run build
npm test
```
