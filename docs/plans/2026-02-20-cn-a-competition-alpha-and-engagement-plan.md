# CN-A Competition Plan: Alpha/Engagement Split + Multi-Symbol Rotation

Goal: improve real trading performance for an upcoming CN-A LLM trading competition while keeping room engagement high through a separate narration/chat system.

## Confirmed Product Decisions

- Trading mode: **multi-symbol portfolio rotation**.
- Trading objective: pure performance (no room-engagement objective in trade decisions).
- Room activity: expose concise public reasoning and increase proactive market/news commentary.
- News focus: tech, macro economy, geopolitics.
- News-trigger burst mode: **enabled** (temporary faster proactive cadence after high-priority fresh headlines).
- Evaluation priority: **return -> max drawdown -> Sharpe -> turnover/cost penalty**.

## Implementation Checklist (Live Status)

- [x] Phase 1: decouple alpha prompt from engagement objective (`runtime-api/src/agentLlmDecision.mjs`, tests added).
- [ ] Phase 2 (in progress): multi-symbol candidate ranking and one-best-action portfolio rotation core.
  - [x] Candidate set is built from full `stock_pool` each cycle and ranked cross-sectionally.
  - [x] LLM decision schema now supports selecting from candidate symbols in one call.
  - [x] Rule fallback uses ranked selected symbol when LLM is unavailable.
  - [ ] Add replay scoreboard comparison vs prior single-symbol rotation baseline.
- [ ] Phase 3 (in progress): portfolio-level risk constraints (max positions, concentration, cash reserve, turnover throttle).
  - [x] Added execution-time guardrails for max position count, concentration, cash reserve, and turnover throttle.
  - [x] Added unit tests for clipping/hold behavior under these guardrails.
  - [ ] Tune default thresholds from multi-day replay before production lock-in.
- [ ] Phase 4: full narrator/engagement separation in chat flow.
- [ ] Phase 5 (in progress): news-driven commentary upgrade.
  - [x] Room context now carries `news_commentary`, `news_categories`, and `news_burst_signal`.
  - [x] Proactive cadence supports news-triggered burst window + cooldown controls.
  - [x] Proactive LLM prompt now explicitly rotates around tech/macro/geopolitics when available.
  - [ ] Validate burst behavior end-to-end in long live-file forward run.
- [ ] Phase 6: pipeline freshness/cadence hardening and watchdog gating.
- [ ] Phase 7: replay/live competition gating scoreboard and runbook sign-off.

## Why This Plan

Current behavior mixes alpha decisions with engagement constraints. That can hurt trading quality. We will separate concerns:

- Alpha engine decides trades for PnL/risk only.
- Narrator engine keeps the room hot with proactive commentary.

This preserves entertainment value without contaminating decision quality.

## Scope

In scope:

- Prompt and decision flow refactor for performance-first trading.
- Multi-symbol candidate ranking and symbol selection per cycle.
- Portfolio-level risk guardrails.
- Proactive chat and news-driven commentary upgrades.
- Replay/live evaluation loop and competition readiness checks.

Out of scope (v1):

- Full autonomous multi-order optimizer every cycle.
- New external paid market data provider migration.
- Fundamental model overhaul beyond prompt/data feature improvements.

## Phase Plan

## Phase 0 - Baseline and Guardrails

1. Capture baseline metrics from existing runtime:
   - return, max drawdown, Sharpe, win rate, turnover, fee drag.
   - decision source ratio, forced-hold rate, readiness OK rate.
2. Keep decision-audit comparability intact.
3. Add feature flags for staged rollout where needed.

Primary files:

- `runtime-api/server.mjs`
- `runtime-api/src/agentLlmDecision.mjs`
- `runtime-api/src/agentDecisionRuntime.mjs`

## Phase 1 - Decouple Alpha Prompt from Engagement

1. Remove room-engagement language from trade decision system prompt.
2. Explicitly allow HOLD as a valid high-quality action.
3. Add explicit optimization priorities in prompt:
   - protect downside first
   - avoid weak-edge trades
   - minimize unnecessary turnover
4. Keep output schema strict and auditable.

Primary files:

- `runtime-api/src/agentLlmDecision.mjs`

## Phase 2 - Multi-Symbol Portfolio Rotation (Core)

1. Build candidate context from full `stock_pool` each cycle (not single rotating symbol only).
2. Compute compact per-symbol snapshots and cross-sectional ranks.
3. Feed candidate set to LLM in one decision call.
4. Return one executable best action per cycle for stability in v1.
5. Keep robust heuristic fallback ranking when LLM fails.

Primary files:

- `runtime-api/server.mjs`
- `runtime-api/src/agentLlmDecision.mjs`
- `runtime-api/src/agentDecisionRuntime.mjs`

## Phase 3 - Portfolio Risk and Sizing Constraints

1. Add portfolio constraints before execution:
   - max position count
   - max symbol concentration
   - min cash reserve
   - turnover throttle
2. Preserve lot size and cash feasibility checks.
3. Keep execution deterministic and auditable.

Primary files:

- `runtime-api/src/agentDecisionRuntime.mjs`

## Phase 4 - Separate Narrator Engine for Room Heat

1. Keep trade decisions performance-only.
2. Expand room context with concise public reasoning summaries:
   - market regime line
   - symbol thesis line
   - risk guardrail line
3. Maintain short Chinese output constraints and anti-spam dedupe.

Primary files:

- `runtime-api/server.mjs`
- `runtime-api/src/chat/chatLlmResponder.mjs`
- `runtime-api/src/chat/chatService.mjs`

## Phase 5 - News-Driven Commentary Upgrade (Tech/Macro/Geopolitics)

1. Use category-aware digest data (`categories`, `commentary`) in room context.
2. Add topic rotation preferences in proactive prompts:
   - tech
   - macro economy
   - geopolitics
3. Add event-triggered proactive comments on fresh high-priority headlines.
4. Enable burst mode:
   - temporary cadence ~8-10s for ~2 minutes on trigger
   - fallback to default ~18s cadence after cooldown
   - keep strict dedupe and cooldown controls

Primary files:

- `runtime-api/server.mjs`
- `runtime-api/src/chat/chatLlmResponder.mjs`
- `runtime-api/src/chat/chatService.mjs`
- `scripts/akshare/run_news_digest_cycle.py`

## Phase 6 - Data Pipeline and Freshness

Keep existing file-based architecture; improve signal richness and cadence discipline.

Required inputs:

- Minute bars: `data/live/onlytrade/frames.1m.json`
- Market overview: `data/live/onlytrade/market_overview.cn-a.json`
- Breadth: `data/live/onlytrade/market_breadth.cn-a.json` (or equivalent current output)
- News digest: `data/live/onlytrade/news_digest.cn-a.json`
- Category digest: `data/live/onlytrade/news_digest.cn-a.v2.json`
- Daily history for trend context: replay/history daily frames

Recommended cadence:

- bars: every 1 minute (session)
- overview/breadth: every 1 minute (session)
- news digest: pre-open + every 5-10 minutes intraday

## Phase 7 - Validation and Competition Gating

1. Replay validation:
   - 1-day and 3-day runs with fixed seeds/configs
2. Live-file forward validation:
   - stale data recovery and watchdog checks
3. Scoreboard per run:
   - return
   - max drawdown
   - Sharpe
   - turnover and fee-adjusted PnL
4. Engagement score checks (separate from alpha):
   - proactive cadence health
   - mention reply success/latency
   - duplicate proactive rate

Primary files/scripts:

- `scripts/cn_a_autopilot_runner.py`
- `scripts/live_autofix_watchdog.py`
- runtime APIs for stats/equity/positions/decision-audit

## Testing Plan

Update/add tests for:

- trade decision prompt/schema behavior
- multi-symbol candidate selection behavior
- risk guardrail clipping behavior
- proactive chat topic rotation and burst mode cooldown
- room context inclusion of category news/commentary

Target test files:

- `runtime-api/test/agentLlmDecision.test.mjs`
- `runtime-api/test/agentDecisionRuntime.test.mjs`
- `runtime-api/test/chatService.test.mjs`
- add chat LLM responder tests if absent

## Rollout Strategy

1. Internal replay-only dry run.
2. Limited live-file run for one agent (`t_001`).
3. Compare against baseline over repeated windows.
4. Expand to additional agents after passing gates.

Rollback:

- Keep feature flags and prompt toggles to quickly disable:
  - multi-symbol mode
  - news-trigger burst mode
  - new risk sizing logic

## Acceptance Criteria

Trading acceptance:

- Better or equal return with lower/equal max drawdown vs baseline.
- Improved Sharpe on out-of-sample replay windows.
- No increase in forced-hold due to readiness regressions.

Room acceptance:

- Proactive messages remain continuous and non-repetitive.
- News commentary visibly covers tech/macro/geopolitics.
- Burst mode triggers correctly and respects cooldown/dedupe.

Operational acceptance:

- No runtime crashes.
- Data freshness remains within thresholds.
- Decision audit stays complete and reviewable.

## Deliverables

- Code changes for Phases 1-5.
- Updated/added tests and passing test evidence.
- Replay/live validation report with before-vs-after metrics.
- Competition runbook with recommended production settings.
