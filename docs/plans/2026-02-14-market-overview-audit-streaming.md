# Implementation Plan - Market Overview + Audit + Streaming Messages

Scope: implement three related features as incremental layers:

1) US + CN market/sector overview adapters (+ news digest headline files)
2) Decision audit + readiness gate + reasoning chain output
3) Streamer-style agent messaging (Chinese output) with 3 message types

This plan is optimized for "show value early" while keeping correctness/auditability.

## Phase 1 - Streamer cadence + style (same day)

Goal: agents talk like livestream hosts quickly, without new market adapters yet.

- Set proactive public interval to 15-20s (recommend default 18s).
- Update proactive/reply prompt to "danmu" host style, Chinese-only, max 2 short sentences.
- Add deterministic post-processing:
  - strip markdown/code fences
  - cap to 2 sentences
  - cap to a short character limit
- Add room-level in-flight lock to avoid duplicate generation under concurrent polling.
- Add basic dedupe vs last N proactive messages.

Verify:

- With `RoomPublicChatPanel` open, new proactive messages appear about every 18s.
- Messages are short Chinese lines.

## Phase 2 - Enrich streamer context (0.5-1 day)

Goal: proactive messages can comment on market/symbol state and still stay grounded.

- Extend the payload passed to message generation:
  - `latest_decision_brief`
  - `symbol_brief` (feature snapshot + last bar timestamp)
  - `data_readiness` (OK/WARN/ERROR + reasons)
  - `market_overview_brief` (if available)
  - `news_digest` headline count + top titles (if available)

Verify:

- Messages reference regime/plan naturally.
- No long sentences.

## Phase 3 - US market overview adapter (Alpaca) (1-2 days)

Goal: create `market.overview.v1` for US.

- Implement a cycle script that:
  - fetches 1m bars for `SPY,QQQ,IWM` + `XLC..XLRE`
  - computes `ret_5` and `ret_20`
  - writes `data/live/onlytrade/market_overview.us.json` atomically
- Implement a run-if-market-open wrapper based on existing NY session utilities.

Verify:

- File refreshes during US regular session.
- Values are populated and timestamps update.

## Phase 4 - CN-A market overview adapter (AKShare) (1-2 days)

Goal: create `market.overview.v1` for CN-A.

- Implement a cycle script that:
  - fetches major index snapshots
  - fetches industry/board heatmap (top/bottom N)
  - maintains small rolling cache to compute ret_5/ret_20
  - writes `data/live/onlytrade/market_overview.cn-a.json` atomically

Verify:

- File refreshes during CN session.
- Sector list is stable and not empty.

## Phase 5 - News digests (headline-only) (0.5-1 day)

Goal: provide daily headline context for streamer talk.

- CN-A: best-effort AKShare headlines -> `news_digest.cn-a.json`
- US: if Alpaca news is available, use it; otherwise write an empty digest file.

Verify:

- Digest files exist daily and are valid JSON.

## Phase 6 - Runtime integration + proxy fallback (1 day)

Goal: attach market/news context to every agent cycle.

- Add runtime live-file overview provider with stale detection and last-good cache.
- Inject `market_overview` and `news_digest` brief into agent context.
- If market_overview is missing/stale:
  - compute `proxy_watchlist` overview from the agent universe
  - mark WARN

Verify:

- In normal conditions, `source_kind=benchmark`.
- When overview is missing, system continues with `source_kind=proxy_watchlist` and WARN.

## Phase 7 - Data readiness gate + audit log (1-2 days)

Goal: prove input correctness/freshness/completeness per decision.

- Implement readiness checks (1m cadence defaults):
  - intraday frames >= 21
  - daily frames >= 61
  - required feature fields present (no silent zeros)
  - freshness WARN>150s, ERROR>330s
- ERROR => force HOLD and skip LLM.
- Write `agent.decision_audit.v1` JSONL per decision.

Verify:

- Missing daily frames causes forced HOLD and a clear audit record.

## Phase 8 - Reasoning chain output (1-2 days)

Goal: viewer-friendly chain per decision.

- Generate 2-4 steps:
  - Data readiness (server)
  - Market regime (LLM or templated)
  - Symbol thesis + decision (LLM)
  - Execution/guardrails (server)
- Enforce short Chinese summaries (TTS-friendly).
- Ensure each step cites only allowed signals.

Verify:

- UI shows steps and they align with decision outcomes.

## Phase 9 - Tests and hardening (ongoing)

- Unit tests:
  - overview stale detection
  - proxy fallback behavior
  - readiness gate forced HOLD
  - proactive lock/dedupe
- Operational:
  - log and surface WARN/ERROR reasons
  - ensure failures do not crash trading loop
