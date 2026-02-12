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

### Build/Update 90-Day Daily History (1d)

```bash
node scripts/update-cn-daily-history.mjs
```

Outputs:

- `data/replay/cn-a/history/frames.1d.90.json`
- `data/replay/cn-a/history/meta.1d.90.json`
- `onlytrade-web/public/replay/cn-a/history/frames.1d.90.json`
- `onlytrade-web/public/replay/cn-a/history/meta.1d.90.json`

Useful env vars:

- `HISTORY_DAYS=90` (default)
- `SYMBOLS=600519.SS,601318.SS,300750.SZ`

Run the same command daily to append newly available `1d` bars and keep the rolling window fresh.

Example cron (Asia/Shanghai close + buffer):

```bash
15 16 * * 1-5 cd /path/to/onlytrade && /usr/bin/node scripts/update-cn-daily-history.mjs >> logs/daily-history.log 2>&1
```

### Run Thin Mock Backend

```bash
cd mock-api
npm install
npm run dev
```

Then run frontend in live mode:

```bash
cd onlytrade-web
VITE_DEMO_MODE=live npm run dev
```

Agent data context endpoint (mock-api):

```bash
curl "http://localhost:8080/api/agent/market-context?symbol=600519.SH&intraday_interval=1m&intraday_limit=180&daily_limit=90"
```

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
