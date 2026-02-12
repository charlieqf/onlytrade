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

### Build Multi-Day Replay Pack (A-share)

```bash
node scripts/fetch-cn-replay.mjs
```

This fetches recent CN-A 1m bars (Yahoo) for a starter symbol set and writes:

- `data/replay/cn-a/<YYYY-MM-DD>/frames.1m.jsonl`
- `onlytrade-web/public/replay/cn-a/latest/frames.1m.json`

Useful env vars:

- `REPLAY_DAYS=3` (default)
- `REPLAY_DATE=2026-02-11` (latest trading day in the replay bundle)
- `SYMBOLS=600519.SS,601318.SS,300750.SZ`

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

## VM Deployment (Git Push -> VM Pull)

Recommended flow:

1. Local machine

```bash
git add -A
git commit -m "your message"
git push origin main
```

2. Ubuntu VM

```bash
cd /path/to/onlytrade
bash scripts/deploy-vm.sh --branch main
```

The deploy script performs:

- `git fetch/checkout/pull --ff-only`
- `npm ci` for `mock-api` and `onlytrade-web`
- tests + frontend build (can be skipped)
- optional PM2/systemd restarts
- API health checks

Useful flags:

- `--skip-tests`
- `--skip-build`
- `--python-venv` (create/update `.venv`)

Python virtualenv helper (if/when Python is used on VM):

```bash
bash scripts/setup-python-venv.sh .venv requirements.txt
source .venv/bin/activate
```

## SSH Ops CLI

Use `scripts/onlytrade-ops.sh` from SSH terminal for common runtime operations.

```bash
# show health/runtime/replay status
bash scripts/onlytrade-ops.sh status

# emergency stop all agents (blocks LLM decisions)
bash scripts/onlytrade-ops.sh kill-on "manual_emergency_stop"

# allow agents again
bash scripts/onlytrade-ops.sh kill-off "manual_resume"

# clean rerun from day-1 first bar and start 3-day replay
bash scripts/onlytrade-ops.sh start-3day --speed 60 --cadence 10

# factory reset only
bash scripts/onlytrade-ops.sh factory-reset --cursor 0
```

Optional secure control token (recommended):

```bash
export ONLYTRADE_CONTROL_TOKEN="your-strong-token"
```

If not exported, the script will try reading `CONTROL_API_TOKEN` from `mock-api/.env.local`.

From local terminal, you can run the same ops via SSH (`ssh -i` under the hood):

```bash
bash scripts/onlytrade-ssh-ops.sh status
bash scripts/onlytrade-ssh-ops.sh kill-on "manual_emergency_stop"
bash scripts/onlytrade-ssh-ops.sh start-3day --speed 60 --cadence 10
```

If repo path on VM is custom:

```bash
export ONLYTRADE_VM_REPO=/your/path/to/onlytrade
bash scripts/onlytrade-ssh-ops.sh status
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
