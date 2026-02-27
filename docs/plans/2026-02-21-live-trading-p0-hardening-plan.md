# Live Trading P0 Hardening Plan (Pre-Live)

Goal: make tomorrow's livestream run safely in true live mode, preserve account/position continuity across days, and still keep manual reset as an operator capability.

## Current Risks (Observed)

- Runtime currently can run in replay mode if `RUNTIME_DATA_MODE=replay`.
- Destructive reset paths exist (`/api/dev/factory-reset`, helper scripts) and can clear memory snapshots.
- Not all control endpoints are protected by token auth.
- Data pipeline freshness can silently degrade if cron/venv/timeouts are inconsistent.
- Runtime process supervision must be explicit for production reliability.

## P0 Scope

1. Live-mode cutover + hard checks
2. Control-plane authorization hardening
3. Safe manual reset design (global + per-agent)
4. Data pipeline continuity and freshness enforcement
5. Position/account continuity guarantees
6. Runtime supervision and recovery
7. Go-live rehearsal and sign-off

## Workstream A - Live Mode Cutover

### Changes

- Set and verify in VM env (`runtime-api/.env.local`):
  - `RUNTIME_DATA_MODE=live_file`
  - `STRICT_LIVE_MODE=true`
  - `RESET_AGENT_MEMORY_ON_BOOT=false`
  - `LIVE_FRAMES_PATH_CN=<canonical live file path>`
  - `LIVE_FILE_REFRESH_MS` and `LIVE_FILE_STALE_MS` (explicit values)
- Add startup validation in `runtime-api/server.mjs`:
  - If `RUNTIME_DATA_MODE=live_file` and required live paths are missing/unreadable, fail fast at boot.
- Add preflight endpoint:
  - `GET /api/ops/live-preflight`
  - Returns pass/fail plus checks for mode, freshness, registry count, market gate state.
- Add ops helper command in `scripts/onlytrade-ops.sh`:
  - `live-preflight`

### Acceptance

- Runtime status reports `data_mode=live_file`.
- Preflight returns `ok=true` before market open.

## Workstream B - Control API Authorization

### Changes

- Require `requireControlAuthorization(...)` for:
  - `POST /api/agent/runtime/control`
  - `POST /api/replay/runtime/control`
  - `POST /api/dev/factory-reset`
  - Recommended: agent registry mutating endpoints (`register/unregister/start/stop`).
- Keep read-only endpoints public.
- Standardize auth failure response: `401 unauthorized_control_token`.
- Add structured audit log line for mutating control actions:
  - timestamp, action, actor/ip, target, result.

### Acceptance

- All mutating control endpoints reject calls without token.
- Existing ops scripts succeed when token is configured.

## Workstream C - Safe Manual Reset (Required)

This is mandatory: reset remains available, but accidental destructive reset is blocked.

### API Design

- Keep global reset endpoint, but add explicit confirmation:
  - `POST /api/dev/factory-reset`
  - Requires:
    - control token auth
    - `confirm: "RESET"`
    - optional `dry_run: true`
- Add scoped per-agent reset endpoint:
  - `POST /api/dev/reset-agent`
  - Body:
    - `trader_id`
    - `reset_memory` (bool)
    - `reset_positions` (bool)
    - `reset_stats` (bool)
    - `confirm: "<trader_id>"`
    - optional `dry_run: true`

### CLI Changes

- In `scripts/onlytrade-ops.sh` and `scripts/onlytrade-ssh-ops.sh`:
  - `agent-reset <id> --full --confirm`
  - `agent-reset <id> --positions-only --confirm`
  - `factory-reset --cursor N --confirm`
- Keep old command names as aliases if needed, but require explicit confirm to execute destructive operations.

### Acceptance

- Manual reset works when explicitly confirmed.
- Unconfirmed reset attempts are rejected with clear error.
- Per-agent reset does not affect other agents.

## Workstream D - Data Pipeline Freshness

### Changes

- Ensure all data jobs use venv interpreter consistently:
  - frames, market overview, news digest, red-blue breadth.
- Verify cron cadence and timeout budget:
  - lock files (`flock`) in place
  - timeout long enough for worst-case fetch latency.
- Add freshness checker script:
  - `scripts/ops/check_live_data_freshness.py`
  - Validates max age thresholds per file.
- Expose freshness summary through API status payload for dashboards.

### Acceptance

- During session, freshness checks stay green.
- If stale, status clearly reports failing file and age.

## Workstream E - Position/Account Continuity

### Changes

- Preserve default behavior:
  - `RESET_AGENT_MEMORY_ON_BOOT=false`.
- Add explicit guardrail in docs and runbook:
  - Do not run `factory-reset` for normal day rollover.
- Add continuity verification command:
  - snapshots of `data/agent-memory/*.json` before/after restart and day boundary.

### Acceptance

- Restart without reset keeps holdings, balances, open lots, and journals intact.
- End-of-day does not automatically clear positions.

## Workstream F - Runtime Supervision

### Changes

- Ensure runtime is managed by systemd (or equivalent) with:
  - `Restart=always`
  - env file loading from `runtime-api/.env.local`
  - single-instance guarantee on API port.
- Add health-restart probe command in ops script.

### Acceptance

- Killing process auto-recovers.
- Exactly one runtime API process binds target port.

## Workstream G - Go-Live Rehearsal

### Steps

1. Run `live-preflight` and confirm all checks pass.
2. Verify 6 agents registered and visible.
3. Verify mutating control endpoints require token.
4. Verify per-agent reset works in dry-run and real mode.
5. Verify global reset requires explicit `confirm`.
6. Restart runtime and confirm continuity persists.
7. Observe one live decision cycle under session gate conditions.

### Exit Criteria

- All P0 acceptance checks pass.
- No unprotected destructive endpoint remains.
- No unintended memory reset path in normal operations.

## File-Level Implementation Map

- `runtime-api/server.mjs`
  - auth guard on control endpoints
  - reset confirmation and scoped reset endpoints
  - live preflight endpoint
- `runtime-api/src/agentMemoryStore.mjs`
  - scoped reset helper(s) if needed for per-agent reset
- `scripts/onlytrade-ops.sh`
  - new preflight/reset commands + confirm flags
- `scripts/onlytrade-ssh-ops.sh`
  - same as above for VM execution
- `docs/runbooks/*`
  - go-live SOP and no-reset-by-default policy

## Rollback Plan

- If auth hardening breaks ops automation:
  - restore previous scripts with token injection fixed
  - keep endpoint auth in place, do not revert security guard
- If live cutover fails:
  - pause agents
  - keep memory intact
  - troubleshoot data freshness and resume after preflight green

## Suggested Execution Order

1. Control auth hardening
2. Safe manual reset API/CLI
3. Live preflight endpoint + script integration
4. Data freshness checks and cron alignment
5. Supervision verification
6. Full rehearsal and sign-off
