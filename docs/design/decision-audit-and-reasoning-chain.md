# Decision Audit + Reasoning Chain (Correct/Fresh/Complete Inputs)

## Problem

Admins and agent owners must be able to review the context behind every decision, without needing to read huge raw inputs. The system must prove:

- the LLM received **correct** inputs (right symbol, right market, right constraints)
- the inputs were **fresh** (not stale vs 1m cadence)
- the inputs were **complete** (no required fields silently missing)

## Key decisions

- Readiness `ERROR` => **force HOLD**, and **skip the LLM call**.
- Market/sector overview missing => allowed fallback `proxy_watchlist` with **WARN**.
- Do not store chain-of-thought. Store **public reasoning** only.

## Goals

- Every decision produces:
  - a deterministic **Data Readiness** report
  - a viewer-friendly **reasoning chain** (2-4 steps)
  - an **audit record** with evidence headers (counts/timestamps/provider/mode)
- Keep audit payloads small (no raw bar arrays).

## Non-goals (v1)

- Perfect reproducibility in live mode (replay can be reproducible; live needs snapshots).
- Full text prompts or full 30-day contexts stored by default.

## Where it plugs into current code

Current decision context assembly is in `runtime-api/server.mjs` inside `evaluateTraderContext(trader, { cycleNumber })`:

- Fetches intraday (`1m`) and daily (`1d`) bars
- Builds `agent.market_context.v1`
- Attaches `memory_state` from `agent.memory.v2`
- Optionally calls OpenAI decider (adds `context.llm_decision`)

Decisions are persisted as JSONL via `runtime-api/src/decisionLogStore.mjs`.

## Contracts

### 1) `agent.decision_audit.v1` (append-only JSONL)

Storage:

- `data/agent-audit/<trader_id>/<YYYY-MM-DD>.jsonl`

Contains:

- Identity: `decision_id`, `trader_id`, `cycle_number`, `created_ts_ms`
- Runtime provenance: `runtime_mode` (`replay|live_file`), exchange, timezone, replay cursor fields (if replay)
- Readiness result:
  - `quality: OK|WARN|ERROR`
  - `checks[]`: `{ id, severity, pass, expected, actual, note }`
- Evidence headers (no raw bars):
  - Symbol intraday/daily: frames_count, provider/mode, last_event_ts_ms
  - `market_overview`: `source_kind`, `generated_at_ts_ms`, stale flags
  - `news_digest`: `generated_at_ts_ms`, headline_count
  - `memory_state`: schema version, updated_at, last_action summary
- Gate outcome:
  - `llm_skipped: boolean`
  - `forced_action: "hold"|null`
  - `forced_reasons[]`

Optional:

- sha256 digests of compact summaries and overview snapshots (integrity)

### 2) `agent.reasoning_chain.v1` (viewer-facing steps)

Embed into the decision record (simplest) and optionally mirror into the audit record.

Step types (2-4 steps total):

- Step 0 (server, always): `data_readiness`
- Step 1 (LLM, common): `market_regime`
- Step 2 (LLM or server, always): `symbol_thesis_and_decision`
- Step 3 (server, conditional): `execution_and_guardrails`

Each step:

- `title` (Chinese)
- `summary` (max 2 short sentences; TTS-friendly)
- `signals_used[]` (enum keys referencing known fields; used for audit)

## Data Readiness Gate

### Default thresholds (1m cadence)

Freshness:

- WARN if now - last_event_ts_ms > 150s
- ERROR if now - last_event_ts_ms > 330s

Completeness:

- ERROR if intraday frames < 21
- ERROR if daily frames < 61

Required feature presence:

- ERROR if any required feature snapshot is missing/null for the decision path.

Important implementation note:

- Missingness must be preserved. Do not coerce missing values to `0`, or reviewers cannot distinguish "missing" from "zero".

### Market overview and news

- `market_overview` from benchmark adapter is preferred.
- If missing/stale/unparseable, compute `proxy_watchlist` and mark WARN.
- News digest missing/empty => WARN only.

## APIs (minimal)

- `GET /api/audit/decisions/latest?trader_id=&limit=`
- `GET /api/audit/decisions/:decision_id`

Optional later:

- `POST /api/audit/decisions/:decision_id/reviews`
- `GET /api/audit/decisions/:decision_id/reviews`

## UI expectations

- Public view:
  - reasoning steps (Chinese) + small readiness badge
- Admin/owner view:
  - readiness checks + evidence headers + forced-hold reasons

## Acceptance Criteria

- Every decision produces an audit record.
- ERROR readiness forces HOLD and skips LLM.
- Reasoning chain is short, Chinese, streamer-friendly, and cites only valid signals.
- Audit proves freshness/completeness without storing raw bar series.
