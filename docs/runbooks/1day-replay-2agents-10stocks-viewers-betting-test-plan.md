# 1-Day Replay Test Plan (2 Agents, 10 Stocks, Viewers, Betting)

## Goal

Validate room/replay stability and behavior under realistic load with:

- 1 replay trading day
- 2 CN-A agents
- 10-stock pools per agent
- multiple concurrent viewers (public/private chat)
- active betting market usage

This plan requires 3 runs with reset between runs:

1. Run A: 5 minutes
2. Run B: 10 minutes (after fix round 1)
3. Run C: 10 minutes (after fix round 2)

---

## Scope and Success Criteria

### In scope

- Agent decisions and execution stability in replay mode
- Room stream packet freshness and SSE continuity
- Viewer chat interaction quality and latency
- Betting market/placement behavior and cutoff logic

### Pass criteria (per run)

- Both agents emit decisions and decision-audit records grow continuously
- `/api/rooms/<agent>/stream-packet` returns valid payloads during run
- Viewer chat messages are accepted; mention/private messages receive agent replies
- Betting API returns market entries for both agents and accepts bet placement
- No backend crash/restart and no sustained 5xx burst

---

## Environment Preconditions

Run on VM (`/opt/onlytrade`) using runtime API on `18080`.

Quick preflight:

```bash
curl -fsS http://127.0.0.1:18080/health
curl -fsS http://127.0.0.1:18080/api/agent/runtime/status
curl -fsS http://127.0.0.1:18080/api/agents/registered
curl -fsS http://127.0.0.1:18080/api/agents/available
curl -fsS http://127.0.0.1:18080/api/traders
curl -fsS "http://127.0.0.1:18080/api/bets/market?trader_id=t_001"
```

Expected:

- API healthy
- LLM wired (`llm.enabled=true`, expected model from runtime status)
- `t_001` and `t_002` are available/registered
- each agent stock pool has 10 symbols

---

## Common Reset/Initialize Procedure (before each run)

> Use this before Run A, Run B, and Run C.

1. Stop agents and pause runtime:

```bash
bash scripts/onlytrade-ops.sh agent-stop t_001
bash scripts/onlytrade-ops.sh agent-stop t_002
bash scripts/onlytrade-ops.sh pause
```

2. Reset runtime/replay/memory:

```bash
# Run A (cold-start behavior):
bash scripts/onlytrade-ops.sh factory-reset --cursor 0

# Run B/C (recommended for natural trading behavior checks):
# bash scripts/onlytrade-ops.sh factory-reset --warmup

bash scripts/onlytrade-ops.sh set-loop off
bash scripts/onlytrade-ops.sh set-speed 1
bash scripts/onlytrade-ops.sh set-cadence 1
```

Notes:

- If the goal is "opening minutes" behavior, keep `--cursor 0`.
- If the goal is "natural trading under load", use `--warmup` for Run B/C to avoid early-bar feature gating noise.

3. Reset test data (test environment only):

```bash
rm -rf data/chat
rm -rf data/decisions
rm -rf data/audit/decision_audit
rm -f data/bets/ledger.json
mkdir -p data/chat data/decisions data/audit/decision_audit data/bets
```

4. Ensure both agents registered and start both:

```bash
curl -fsS -X POST http://127.0.0.1:18080/api/agents/t_001/register -H "Content-Type: application/json" -d '{}'
curl -fsS -X POST http://127.0.0.1:18080/api/agents/t_002/register -H "Content-Type: application/json" -d '{}'
bash scripts/onlytrade-ops.sh agent-start t_001
bash scripts/onlytrade-ops.sh agent-start t_002
bash scripts/onlytrade-ops.sh resume
```

5. Seed betting activity (minimum):

```bash
# place at least 10 bets split across t_001 and t_002 (example curl style)
# bootstrap session -> place bet; repeat with multiple viewers
curl -fsS -X POST http://127.0.0.1:18080/api/chat/session/bootstrap -H "Content-Type: application/json" -d '{"user_nickname":"viewer_seed_01"}'
```

---

## Run A (5 minutes)

### Execute

1. Start viewer simulators (concurrent):

```bash
python3 scripts/simulate_viewers_chat.py --api-base http://127.0.0.1:18080 --room-id t_001 --viewers 6 --duration-min 5 --log-path logs/soak/runA_t001_viewers.jsonl
python3 scripts/simulate_viewers_chat.py --api-base http://127.0.0.1:18080 --room-id t_002 --viewers 6 --duration-min 5 --log-path logs/soak/runA_t002_viewers.jsonl
```

2. During run, sample every minute:

```bash
curl -fsS "http://127.0.0.1:18080/api/rooms/t_001/stream-packet?decision_limit=5"
curl -fsS "http://127.0.0.1:18080/api/rooms/t_002/stream-packet?decision_limit=5"
curl -fsS "http://127.0.0.1:18080/api/agents/t_001/decision-audit/latest?limit=20"
curl -fsS "http://127.0.0.1:18080/api/agents/t_002/decision-audit/latest?limit=20"
curl -fsS "http://127.0.0.1:18080/api/bets/market?trader_id=t_001"
```

### Review A

- Inspect `logs/soak/runA_*`, backend log, decision-audit growth, chat reply latency, bet pool updates.
- Categorize issues: `critical` (crash/data corruption), `major` (broken feature), `minor` (quality/UX).
- Create fix list and apply Fix Round 1.
- If many forced HOLDs are due to early-bar readiness, treat this as setup/readiness policy signal (not necessarily a strategy defect).

---

## Fix Round 1

- Implement highest-priority issues from Review A.
- Rebuild/restart services if required.
- Re-check health endpoints before next run.

---

## Run B (10 minutes)

1. Execute **Common Reset/Initialize Procedure** with warmup reset (`factory-reset --warmup`).
2. Run viewer simulators for 10 minutes:

```bash
python3 scripts/simulate_viewers_chat.py --api-base http://127.0.0.1:18080 --room-id t_001 --viewers 8 --duration-min 10 --log-path logs/soak/runB_t001_viewers.jsonl
python3 scripts/simulate_viewers_chat.py --api-base http://127.0.0.1:18080 --room-id t_002 --viewers 8 --duration-min 10 --log-path logs/soak/runB_t002_viewers.jsonl
```

3. Repeat minute-level sampling and endpoint checks (same as Run A).

### Review B

- Compare Run B vs Run A metrics: stability, decision continuity, reply latency, bet updates.
- Build second fix list focused on remaining defects and quality gaps.

---

## Fix Round 2

- Apply second round of fixes.
- Rebuild/restart and confirm health.

---

## Run C (10 minutes)

1. Execute **Common Reset/Initialize Procedure** with warmup reset (`factory-reset --warmup`).
2. Run same dual-room viewer load for 10 minutes.
3. Repeat endpoint checks and collect final artifacts.

---

## Final Report Template

For each run (A/B/C), record:

- start/end timestamps
- active agents and stock pools (10 symbols)
- viewer counts and message totals by room
- chat quality metrics (reply success ratio, p95 latency, duplicate `@mention` pattern count)
- decision counts and audit counts by agent
- bet totals/ticket counts and distribution by agent
- notable errors (API 4xx/5xx, timeouts, SSE drops)
- fixes applied between runs

Final verdict:

- `ready` / `not ready` for full 1-day replay with 2-agent + viewer + betting load
- top remaining risks
- concrete next actions

---

## Post-Test Restoration

After focused 2-agent runs, restore full lobby registration if needed:

```bash
bash scripts/onlytrade-ops.sh agent-register t_003
bash scripts/onlytrade-ops.sh agent-register t_004
bash scripts/onlytrade-ops.sh agent-register us_001
bash scripts/onlytrade-ops.sh agent-register us_002
bash scripts/onlytrade-ops.sh agents-registered
curl -fsS http://127.0.0.1:18080/api/traders
```

---

## Lessons Captured (2026-02 Cycle)

- Cold-start (`cursor 0`) can underrepresent trading naturalness in short runs due to intraday feature readiness.
- Warmup start is better for B/C when evaluating realistic decision diversity.
- Track duplicate-mention artifact count in chat QA (now fixed in responder logic, keep as regression metric).
- Focused runs that re-register only target agents can leave lobby showing fewer agents; restore registry after test.
