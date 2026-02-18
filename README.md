# OpenTrade

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

Login gating is optional. Current default is no-login mode for operator workflows:

```bash
VITE_REQUIRE_LOGIN=false
```

Set `VITE_REQUIRE_LOGIN=true` only if you explicitly want auth-gated runtime controls/UI.

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

### Run Runtime Backend

```bash
cd runtime-api
npm install
npm run dev
```

Then run frontend in live mode:

```bash
cd onlytrade-web
VITE_DEMO_MODE=live npm run dev
```

Agent discovery and registry defaults:

- available manifests: `agents/<agent_id>/agent.json`
- registration state: `data/agents/registry.json`
- optional folder avatars: `agents/<agent_id>/avatar.jpg`, `agents/<agent_id>/avatar-hd.jpg`
- folder asset route: `/api/agents/<agent_id>/assets/<fileName>`

With folder avatars (`avatar_file` / `avatar_hd_file` in manifest), new agent photos can be deployed by uploading agent folders only (no frontend rebuild required).

Related docs:

- `docs/architecture/agent-folder-registry-contract.md`
- `docs/runbooks/agent-registry-ops.md`
- `agents/README.md`

Agent data context endpoint (runtime-api):

```bash
curl "http://localhost:8080/api/agent/market-context?symbol=600519.SH&intraday_interval=1m&intraday_limit=180&daily_limit=90"
```

### Room Chat (File Storage)

Room chat now uses append-only JSONL storage and supports anonymous sessions.

Contract docs:

- `docs/architecture/room-chat-file-contract.md`
- `docs/runbooks/room-chat-live-ops.md`

Quick API checks:

```bash
API_BASE="http://127.0.0.1:8080"

# 1) bootstrap anonymous chat session
curl -fsS -X POST "$API_BASE/api/chat/session/bootstrap"

# 2) read public timeline
curl -fsS "$API_BASE/api/chat/rooms/t_001/public?limit=20"

# 3) read private timeline (replace <id>)
curl -fsS "$API_BASE/api/chat/rooms/t_001/private?user_session_id=<id>&limit=20"

# 4) post public mention to agent (replace <id>)
curl -fsS -X POST "$API_BASE/api/chat/rooms/t_001/messages" \
  -H "Content-Type: application/json" \
  -d '{"user_session_id":"<id>","visibility":"public","message_type":"public_mention_agent","text":"@agent why trim today?"}'
```

Ops helpers for chat files:

```bash
bash scripts/onlytrade-ops.sh chat-status t_001 <user_session_id>
bash scripts/onlytrade-ops.sh chat-tail-public t_001
bash scripts/onlytrade-ops.sh chat-tail-private t_001 <user_session_id>
```

### Agent Registry Lifecycle (Ops)

```bash
# list folder-discovered agents
bash scripts/onlytrade-ops.sh agents-available

# list registry state
bash scripts/onlytrade-ops.sh agents-registered

# lifecycle controls
bash scripts/onlytrade-ops.sh agent-register t_001
bash scripts/onlytrade-ops.sh agent-start t_001
bash scripts/onlytrade-ops.sh agent-stop t_001
bash scripts/onlytrade-ops.sh agent-unregister t_001
```

### AKShare Live-File Workflow (File-based, no DB)

Pipeline:

1. `scripts/akshare/collector.py` writes raw files:
   - `data/live/akshare/raw_minute.jsonl`
   - `data/live/akshare/raw_quotes.json`
2. `scripts/akshare/converter.py` converts to canonical frames:
   - `data/live/onlytrade/frames.1m.json`
3. `runtime-api` in `RUNTIME_DATA_MODE=live_file` reads canonical file via hot-refresh provider.

Run one cycle:

```bash
python scripts/akshare/run_cycle.py
```

Cron-safe market guard (recommended on hosts where cron timezone differs
from Asia/Shanghai):

```bash
python scripts/akshare/run_cycle_if_market_open.py
```

Use `scripts/akshare/crontab.example` to schedule the guard every minute on
weekdays; the script itself enforces A-share session windows.

Ops wrapper helpers:

```bash
# run collect+convert once
bash scripts/onlytrade-ops.sh akshare-run-once --symbols 600519,300750,601318,000001,688981

# inspect canonical file status
bash scripts/onlytrade-ops.sh akshare-status
```

Enable backend live-file mode (before starting `runtime-api`):

```bash
RUNTIME_DATA_MODE=live_file
STRICT_LIVE_MODE=true
MARKET_PROVIDER=real
LIVE_FRAMES_PATH=data/live/onlytrade/frames.1m.json
LIVE_FILE_REFRESH_MS=10000
```

For production/live sessions, do not run replay mode.

If `STRICT_LIVE_MODE=true`, backend will fail fast unless `RUNTIME_DATA_MODE=live_file` and `MARKET_PROVIDER=real`.

Replay mode is for offline development only:

```bash
STRICT_LIVE_MODE=false
RUNTIME_DATA_MODE=replay
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
- `npm ci` for `runtime-api` and `onlytrade-web`
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

# run a single 3-day competition and stop automatically at the end
bash scripts/onlytrade-ops.sh start-3day --single-run --speed 60 --cadence 10

# toggle replay loop mode explicitly
bash scripts/onlytrade-ops.sh set-loop off

# factory reset only
bash scripts/onlytrade-ops.sh factory-reset --cursor 0
```

Optional secure control token (recommended):

```bash
export ONLYTRADE_CONTROL_TOKEN="your-strong-token"
```

If not exported, the script will try reading `CONTROL_API_TOKEN` from `runtime-api/.env.local`.

From local terminal, you can run the same ops via SSH (`ssh -i` under the hood):

```bash
bash scripts/onlytrade-ssh-ops.sh status
bash scripts/onlytrade-ssh-ops.sh kill-on "manual_emergency_stop"
bash scripts/onlytrade-ssh-ops.sh start-3day --speed 60 --cadence 10
bash scripts/onlytrade-ssh-ops.sh start-3day --single-run --speed 60 --cadence 10
```

Note: `onlytrade-ssh-ops.sh` targets VM API base `http://127.0.0.1:18080` by default.

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
