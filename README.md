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

Milestone 2 mode:

```bash
VITE_DEMO_MODE=mock-live npm run dev
```

Set `VITE_DEMO_MODE=live` to disable static mock interception and use real APIs.

### Build Yesterday Replay Pack (A-share)

```bash
node scripts/fetch-cn-replay.mjs
```

This fetches yesterday 1m bars (Yahoo) for a starter CN-A symbol set and writes:

- `data/replay/cn-a/<YYYY-MM-DD>/frames.1m.jsonl`
- `onlytrade-web/public/replay/cn-a/latest/frames.1m.json`

## Planning + Progress

- `docs/IMPLEMENTATION_PLAN.md`
- `docs/DEMO_MILESTONES.md`
- `docs/PROGRESS.md`
- `docs/UI_COMPLETE_CHECKLIST.md`
- `docs/MARKET_DATA_STANDARD.md`
- `docs/A_SHARE_REALTIME_RETRIEVAL.md`
- `docs/TESTING.md`

## Third-party

See `THIRD_PARTY_NOTICES.md`.
