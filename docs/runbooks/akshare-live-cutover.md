# AKShare Live Mode Cutover Runbook

## Scope

Switch OnlyTrade market data for agents from replay mode to live-file mode backed by AKShare collector/converter outputs.

## Preconditions

- `scripts/akshare/run_cycle.py` can run successfully on host.
- Canonical output exists at `data/live/onlytrade/frames.1m.json`.
- Breadth output exists at `data/live/onlytrade/market_breadth.cn-a.json`.
- Legal/compliance sign-off completed for AKShare usage in your environment.

## Market-Open Day Quick Flow

Use this flow on open day to avoid mode confusion and stale-file surprises.

1. Before open (for stream chatter): switch to `live_file`, keep guard relaxed.
2. At open: verify AKShare gated jobs stop returning `outside_cn_a_session`.
3. Re-check freshness (`--strict`) and `live-preflight`.
4. If all required CN files are fresh, continue in live mode.
5. If freshness fails for >3 minutes during session, pause agents and recover pipeline first.

## Pre-Open Live Talk Mode (No Replay)

If market is not open yet and you want rooms to stream news/chatter (for example `t_003` and `t_004`):

1. Set runtime mode to live file in `runtime-api/.env.local`:

```env
RUNTIME_DATA_MODE=live_file
STRICT_LIVE_MODE=false
AGENT_SESSION_GUARD_ENABLED=false
```

2. Ensure CN news material is refreshed:

```bash
bash scripts/onlytrade-ssh-ops.sh news-digest-cn-run-once
```

3. Restart backend with single-instance check (important):

```bash
bash scripts/onlytrade-ssh-ops.sh health-restart-probe
```

4. Confirm mode is really live:

```bash
curl -fsS "http://127.0.0.1:18080/api/replay/runtime/status"
```

Expected: `data_mode: live_file`.

5. Resume runtime and ensure room agents are running:

```bash
bash scripts/onlytrade-ssh-ops.sh resume
bash scripts/onlytrade-ssh-ops.sh agent-start t_003
bash scripts/onlytrade-ssh-ops.sh agent-start t_004
```

Note: pre-open `run_cycle_if_market_open.py` will still return `outside_cn_a_session`; this is expected.

## Enable live mode

1. Run one full cycle:

```bash
python scripts/akshare/run_cycle.py
python scripts/akshare/run_red_blue_cycle.py
```

2. Set environment for backend:

```bash
RUNTIME_DATA_MODE=live_file
LIVE_FRAMES_PATH=data/live/onlytrade/frames.1m.json
LIVE_FILE_REFRESH_MS=10000
```

3. Restart `runtime-api`.

4. Ensure scheduler includes both jobs:
   - `scripts/akshare/run_cycle_if_market_open.py`
   - `scripts/akshare/run_red_blue_if_market_open.py`

## Single-Instance Restart Guardrail (Critical)

Do not leave multiple `node server.mjs` processes running; old process can keep binding `:18080` and serve the wrong mode.

After any mode change restart, verify listener ownership:

```bash
ss -ltnp | grep ':18080'
ps -ef | grep 'node server.mjs' | grep -v grep
```

Expected: one listener and one runtime-api process.

If more than one process exists, stop all and start one clean instance.

## Verify live mode

```bash
curl -fsS "http://127.0.0.1:18080/api/replay/runtime/status"
curl -fsS "http://127.0.0.1:18080/api/market/frames?symbol=600519.SH&interval=1m&limit=5"
curl -fsS "http://127.0.0.1:18080/api/agent/context?trader_id=t_001"
curl -fsS "http://127.0.0.1:18080/api/rooms/t_001/stream-packet?decision_limit=2"
```

Expected:

- Replay status includes `data_mode: live_file`.
- Replay status `live_file.last_load_ts_ms` is recent.
- `provider: akshare` with non-empty `frames` for watched symbols.
- Stream packet has `market_breadth.source_kind = breadth_file` and non-stale status.

Additional open-day expected fields in `/api/agent/runtime/status`:

- `market_overview_files.cn_a.stale == false`
- `market_breadth_files.cn_a.stale == false`
- `news_digest_files.cn_a.stale == false`
- `live_data_freshness.checks.frames_cn_a.ok == true`

Recommended preflight endpoint check:

```bash
curl -fsS "http://127.0.0.1:18080/api/ops/live-preflight"
```

Or with ops helper:

```bash
bash scripts/onlytrade-ops.sh live-preflight
```

## Runtime checks

- If `live_file.stale=true`, inspect collector/converter logs immediately.
- If canonical parse fails, backend should continue serving last good cache.
- During market close, stale alerts should use broader thresholds.
- Before open, `run_cycle_if_market_open.py` and `run_red_blue_if_market_open.py` can return `outside_cn_a_session` and should not be treated as failures.

Freshness checker script:

```bash
python scripts/ops/check_live_data_freshness.py --repo-root /opt/onlytrade --strict
```

Or via ops helper:

```bash
bash scripts/onlytrade-ops.sh check-live-freshness --strict
```

## Continuity guardrail (day rollover)

- Do **not** run global `factory-reset` for normal day rollover.
- Keep `RESET_AGENT_MEMORY_ON_BOOT=false` in production/live sessions.
- Use continuity snapshot before/after restart/day boundary:

```bash
bash scripts/onlytrade-ops.sh continuity-snapshot logs/continuity-before.json
# restart runtime
bash scripts/onlytrade-ops.sh continuity-snapshot logs/continuity-after.json
```

If manual reset is required, explicit confirmation is mandatory:

```bash
bash scripts/onlytrade-ops.sh factory-reset --cursor 0 --confirm
bash scripts/onlytrade-ops.sh agent-reset t_001 --full --confirm
```

## Rollback

1. Set `RUNTIME_DATA_MODE=replay`.
2. Restart backend.
3. Verify replay controls/status operate normally:

```bash
curl -fsS "http://127.0.0.1:18080/api/replay/runtime/status"
```

4. If needed, run clean replay reset:

```bash
bash scripts/onlytrade-ssh-ops.sh start-3day --single-run --speed 60 --cadence 10
```

## Go / No-Go Checklist (Open)

Go live only when all are true:

- `data_mode == live_file`
- single runtime listener on `:18080`
- required CN files fresh under threshold (`check-live-freshness --strict`)
- `live-preflight` returns `ok=true`
- room events endpoint stable: `GET /api/rooms/t_003/events`

No-go (hold in pre-open talk mode) when any is true:

- `outside_cn_a_session` before open (expected; hold)
- any required CN file stale for >3 minutes after open
- duplicate runtime-api processes bound or racing
- `live_file.last_error` persists

## Runtime supervision baseline (systemd)

Recommended unit properties:

- `Restart=always`
- `RestartSec=2`
- `EnvironmentFile=/opt/onlytrade/runtime-api/.env.local`
- `WorkingDirectory=/opt/onlytrade/runtime-api`
- `ExecStart=/usr/bin/node server.mjs`

Single-instance check on API port:

```bash
bash scripts/onlytrade-ops.sh health-restart-probe
```

Expected: `health_ok=true` and listener count on API port equals `1`.
