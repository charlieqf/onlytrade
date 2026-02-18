# CN-A Agent/Room Autopilot Soak Runbook

Goal: run a hands-off 1-day CN-A replay at real speed, keep one CN-A agent under continuous stress, validate room streaming/chat behavior, and auto-restore VM runtime mode when finished.

## Safety Guardrails

- Do not modify local machine services.
- Do not delete runtime/chat/audit data.
- Restart only the `node server.mjs` process whose cwd is `/opt/onlytrade/mock-api`.
- Always restore backend to `live_file` mode by restarting without replay env overrides at the end.
- Restore per-agent running states to baseline captured at start.

## What gets tested

- Functionality
  - `/api/rooms/<agent>/stream-packet`
  - `/api/rooms/<agent>/events` (SSE)
  - `/api/agents/<agent>/decision-audit/latest`
  - `/api/chat/rooms/<agent>/public`
- Strategy/runtime behavior
  - replay cursor progression at real speed (`speed=1`)
  - decision/audit growth over time
  - forced-hold/readiness patterns from decision meta
- Streaming effect
  - sustained SSE connection with reconnect handling
  - stream-packet freshness checks
  - mention-response checks in public room chat

## Autopilot runner

Script: `scripts/cn_a_autopilot_runner.py`

Default behavior:

- switches backend to replay mode (process-level env override only)
- isolates one CN-A agent (default `t_001`) for focused testing
- runs 1-minute bar / 1-minute decision cadence
- performs periodic probes and mention tests
- supports accelerated replay via `--replay-speed` while keeping 5-minute pause/review checkpoints
- stops after one replay day completes (or max duration)
- restores agent running set + backend live mode

## Standard launch (VM)

```bash
cd /opt/onlytrade
python3 scripts/cn_a_autopilot_runner.py \
  --repo-root /opt/onlytrade \
  --api-base http://127.0.0.1:18080 \
  --agent-id t_001 \
  --duration-min 245 \
  --replay-speed 1 \
  --review-interval-min 5 \
  --mention-interval-min 20
```

Background launch:

```bash
cd /opt/onlytrade
mkdir -p logs/soak
nohup python3 scripts/cn_a_autopilot_runner.py \
  --repo-root /opt/onlytrade \
  --api-base http://127.0.0.1:18080 \
  --agent-id t_001 \
  --duration-min 245 \
  --replay-speed 12 \
  --review-interval-min 5 \
  --mention-interval-min 20 \
  > logs/soak/autopilot-launch.log 2>&1 &
```

## Artifacts

Per run, files are written under:

- `/opt/onlytrade/logs/soak/<run_id>/metrics.jsonl`
- `/opt/onlytrade/logs/soak/<run_id>/mentions.jsonl`
- `/opt/onlytrade/logs/soak/<run_id>/reviews.jsonl`
- `/opt/onlytrade/logs/soak/<run_id>/events.sse.log`
- `/opt/onlytrade/logs/soak/<run_id>/summary.json`
- `/opt/onlytrade/logs/soak/<run_id>/runner.log`

## 5-minute pause-review loop

With `--review-interval-min 5`, the runner does this every 5 minutes:

1. Pause runtime + replay.
2. Review the previous window (endpoint OK rate, LLM decision ratio, readiness OK rate).
3. Apply safe tuning guardrails (re-assert speed=1, loop=false, cadence=1; re-assert target-agent isolation if window had errors).
4. Resume runtime + replay.

Each checkpoint is appended to `reviews.jsonl`.

## Replay completion behavior

- Primary completion rule: stop when replay `day_index` advances.
- Fallback completion rule: if replay stops on the current day with `completed=true` (or cursor reaches end-of-day bar), treat that as successful one-day completion.

## Quick health checks during run

```bash
curl -fsS http://127.0.0.1:18080/api/replay/runtime/status
curl -fsS http://127.0.0.1:18080/api/agent/runtime/status
curl -fsS "http://127.0.0.1:18080/api/rooms/t_001/stream-packet?decision_limit=5"
curl -fsS "http://127.0.0.1:18080/api/agents/t_001/decision-audit/latest?limit=20"
```

Public-IP checks (when API is exposed on VM):

```bash
curl -fsS "http://104.238.213.119:18080/api/replay/runtime/status"
curl -fsS "http://104.238.213.119:18080/api/agent/runtime/status"
curl -fsS "http://104.238.213.119:18080/api/rooms/t_001/stream-packet?decision_limit=5"
```

If HTTP 80/443 on the public IP is routed to a different service, validate OnlyTrade via the API port (or the dedicated OnlyTrade web domain/path).

## Exit criteria

- no sustained 404/5xx on core room endpoints
- replay day advances and completes one full day
- decision-audit count increases over run
- mention checks receive agent reply within timeout
- final restore verification shows `data_mode=live_file`
