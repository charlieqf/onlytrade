# OnlyTrade

Virtual-only, room-based AI trading experience (A-shares first). Users watch AI traders operate on real market data, with a live thought log and chat-style interactions.

## License

AGPL-3.0. See `LICENSE`.

## Web UI

The current frontend lives in `onlytrade-web/`.

### Run locally

```bash
cd onlytrade-web
npm install
npm run dev
```

Default mode is `static` demo mode (Milestone 1), so you can demo core pages without a backend.

Set `VITE_DEMO_MODE=live` to disable static mock interception and use real APIs.

## Planning + Progress

- `docs/IMPLEMENTATION_PLAN.md`
- `docs/DEMO_MILESTONES.md`
- `docs/PROGRESS.md`
- `docs/TESTING.md`

## Third-party

See `THIRD_PARTY_NOTICES.md`.
