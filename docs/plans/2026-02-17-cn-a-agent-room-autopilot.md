# CN-A Agent/Room Autopilot Plan

Goal: run an unattended 3-4 hour validation/improvement loop for one CN-A room agent using 1-day replay at real speed, then safely restore VM runtime state.

## Constraints

- No destructive VM actions (no reset/hard-clean of data stores).
- No risky local-PC operations.
- Keep process management scoped to OnlyTrade backend process in `/opt/onlytrade/mock-api`.
- Always capture baseline and restore on exit.

## Phase 0 - Baseline Capture

1. Record current backend health/runtime/replay status.
2. Record current trader running states from `/api/traders`.
3. Save artifacts to per-run log directory for rollback and audit trail.

## Phase 1 - Controlled Replay Setup

1. Restart backend in replay mode using env overrides only:
   - `RUNTIME_DATA_MODE=replay`
   - `STRICT_LIVE_MODE=false`
   - `REPLAY_SPEED=1`
   - `REPLAY_LOOP=false`
   - `AGENT_DECISION_EVERY_BARS=1`
2. Verify core endpoints return 200.
3. Isolate one CN-A agent under test (`t_001`):
   - stop other `t_*` agents
   - ensure target agent is running

## Phase 2 - One-Day Real-Speed Execution

1. Initialize replay at start of day-2 (`factory-reset cursor=240`) so intraday indicators have prior-day context.
2. Resume replay + runtime.
3. Maintain continuous SSE room connection for viewer-gated streaming behavior.
4. Every 60s collect probes:
   - replay status
   - runtime status
   - stream packet
   - decision audit latest
   - public chat recent messages
5. Every 20 minutes run mention-response test (`@agent ...`) and measure reply success/latency.
6. Auto-heal rules:
   - if runtime paused unexpectedly, resume
   - if replay paused before day complete, resume
7. Every 5 minutes, pause and run a review checkpoint:
   - summarize last window endpoint/decision/readiness metrics
   - apply safe guardrail improvements (re-assert speed/cadence/loop; re-assert target-agent isolation if needed)
   - resume runtime and replay
8. Stop test when replay day transitions to next day (or max duration reached).

## Phase 3 - Quality Review + Improvement Loop

1. Aggregate metrics:
   - endpoint success rate
   - decision/audit growth
   - mention pass rate and latency
   - forced-hold/readiness trends
2. Apply safe runtime tuning only if needed (cadence/stream interval/proactive chat interval).
3. Re-check probes after each tuning change.

## Phase 4 - Safe Restore

1. Pause replay/runtime.
2. Restart backend in default live mode (no replay overrides).
3. Restore agent running states from baseline snapshot.
4. Verify:
   - `/api/replay/runtime/status` shows `data_mode=live_file`
   - key room endpoints return 200

## Deliverables

- Run log folder with:
  - `metrics.jsonl`
  - `mentions.jsonl`
  - `events.sse.log`
  - `summary.json`
  - `runner.log`
- Human summary with:
  - what improved
  - what still needs work
  - recommended permanent settings
