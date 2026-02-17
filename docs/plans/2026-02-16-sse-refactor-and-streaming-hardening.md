#!/usr/bin/env markdown
# SSE + Streaming + Audit Explorer Refactor Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve reliability and maintainability of the Room SSE backbone + streaming UI, fix a correctness bug in StreamingRoomPage account fields, and reduce unnecessary work per stream packet.

**Architecture:**
- Keep the external API contract stable (`/api/rooms/:roomId/events`, `chat_public_append`, `stream_packet`, `decision`), but harden internals (no overlapping timers, no duplicated snapshot building, bounded in-memory state).
- Consolidate shared concerns into small modules/hooks: a runtime "room SSE hub" (server) and a web `useRoomSse()` hook (client).

**Tech Stack:**
- Backend: Node.js (ESM), Express, Server-Sent Events (SSE), node:test.
- Frontend: React, TypeScript, SWR, EventSource, Vitest/Playwright.

---

## Scope

### In scope (high ROI)
- Backend: prevent overlapping per-room `stream_packet` builds; remove duplicate market overview/news digest work per packet.
- Backend: make large audit JSONL reads memory-safe.
- Frontend: fix StreamingRoomPage account field mismatches; add missing chat message typing for agent message kinds.
- Frontend: bound long-lived state in Danmu overlay; reduce unnecessary canvas work when idle/hidden.
- Frontend: extract SSE wiring out of `onlytrade-web/src/App.tsx` into a dedicated hook.

### Not in scope (defer)
- Changing SSE event names or payload schemas.
- Introducing new persistence backends (Redis, DB) for SSE replay buffer.
- Replacing SWR with another cache library.

## Success criteria

- `runtime-api` tests pass: `npm test` (from `runtime-api/`).
- `onlytrade-web` tests/build pass: `npm run build` and at least unit tests `npm test` (from `onlytrade-web/`).
- Streaming page shows correct numeric values (equity, unreal pnl, margin) sourced from `AccountInfo`.
- No concurrent/overlapping `buildRoomStreamPacket()` runs per room (even if one run is slow).
- Room stream packet building performs only one overview/digest fetch path per packet.

---

## Phase 0: Baseline + guardrails

### Task 0.1: Create a dedicated worktree (recommended)

**Files:** none

**Steps**
1. Create a worktree/branch.
2. Capture baseline test status.

**Commands**
```bash
git status -sb
git log -n 5 --oneline

# runtime-api
cd runtime-api && npm test

# onlytrade-web
cd onlytrade-web && npm test
cd onlytrade-web && npm run build
```

Expected: tests may already pass; record failures (if any) before refactor.

---

## Phase 1: Fix correctness bug on StreamingRoomPage (fast, high impact)

### Task 1.1: Fix account field usage on streaming page

**Why:** `onlytrade-web/src/pages/StreamingRoomPage.tsx` renders fields not present on `AccountInfo` (e.g. `total_balance`, `total_unrealized_profit`). This likely produces wrong UI output.

**Files:**
- Modify: `onlytrade-web/src/pages/StreamingRoomPage.tsx`
- Reference: `onlytrade-web/src/types.ts` (`AccountInfo`)

**Step 1: Add a minimal unit test (optional but preferred)**

If the repo has no existing test harness for this component, skip and rely on `npm run build` + manual check.

**Step 2: Implement the fix**

Change rendering to match `AccountInfo`:
- equity: `account.total_equity`
- unreal pnl: `account.unrealized_profit`
- margin: `account.margin_used_pct` (already a percentage in this app; do NOT multiply by 100)

**Step 3: Verify**

Commands:
```bash
cd onlytrade-web && npm run build
```

**Step 4: Manual smoke**

Run the web app, open `/stream?trader=...` and confirm the bet summary fields show numbers and update.

**Commit**
```bash
git add onlytrade-web/src/pages/StreamingRoomPage.tsx
git commit -m "fix(web): correct streaming account fields"
```

---

## Phase 2: Tighten chat typing and use it to reduce `any`

### Task 2.1: Add `agent_message_kind` to `ChatMessage` type

**Why:** runtime emits `agent_message_kind` (`reply`/`proactive`/`narration`) via `runtime-api/src/chat/chatAgentResponder.mjs`, but the web type omits it.

**Files:**
- Modify: `onlytrade-web/src/types.ts`
- Reference: `runtime-api/src/chat/chatAgentResponder.mjs`

**Step 1: Update types**

Add:
```ts
agent_message_kind?: 'reply' | 'proactive' | 'narration'
```

**Step 2: Replace unsafe casts where easy**

In `onlytrade-web/src/App.tsx`, remove the `as any` for chat payload message arrays when possible.

**Step 3: Verify**
```bash
cd onlytrade-web && npm run build
```

**Commit**
```bash
git add onlytrade-web/src/types.ts onlytrade-web/src/App.tsx
git commit -m "refactor(web): type chat agent message kinds"
```

---

## Phase 3: Runtime SSE timer hardening (prevent overlap)

### Background

Current behavior (good):
- Per-room subscriber set + per-room keepalive and stream-packet timers in `runtime-api/server.mjs`.

Current risk:
- `ensureRoomStreamPacketTimer()` uses `setInterval(async () => ...)` with no in-flight guard. If packet build takes longer than interval, runs can overlap.

### Task 3.1: Add an in-flight guard for per-room packet builds

**Files:**
- Modify: `runtime-api/server.mjs`

**Step 1: Write a failing integration test**

Add a new test to `runtime-api/test/roomEventsRoutes.test.mjs` that:
- starts server with a very small packet interval
- forces packet building to be slow
- asserts the server does not emit more than 1 packet per interval window

To make this testable without invasive mocking, introduce a test-only env var:
- `ROOM_EVENTS_PACKET_BUILD_DELAY_MS` (when set, `buildRoomStreamPacket()` waits before returning)

Test skeleton:
```js
test('room stream_packet timer does not overlap builds', async (t) => {
  // Start with interval_ms=2000
  // Set ROOM_EVENTS_PACKET_BUILD_DELAY_MS=3500
  // Connect SSE, wait ~7s, count stream_packet occurrences in text
  // Expect count to be small (e.g. <= 3 including initial packet)
})
```

**Step 2: Implement minimal delay hook (test-only)**

In `buildRoomStreamPacket()`:
```js
const delayMs = Number(process.env.ROOM_EVENTS_PACKET_BUILD_DELAY_MS || 0)
if (Number.isFinite(delayMs) && delayMs > 0) {
  await delay(delayMs)
}
```

**Step 3: Implement in-flight guard**

Add a map like:
```js
const roomStreamPacketBuildInFlightByRoom = new Map()
```

In the timer callback:
- if in-flight, skip this tick
- otherwise set in-flight true, run build, finally clear

**Step 4: Run tests**
```bash
cd runtime-api && npm test
```

**Commit**
```bash
git add runtime-api/server.mjs runtime-api/test/roomEventsRoutes.test.mjs
git commit -m "fix(runtime): prevent overlapping room stream packet builds"
```

---

## Phase 4: Remove duplicated snapshot work per stream packet

### Task 4.1: De-duplicate overview/digest fetching between `buildRoomChatContext` and `buildRoomStreamPacket`

**Why:** `buildRoomChatContext()` currently fetches market overview + news digest, and `buildRoomStreamPacket()` fetches them again.

**Files:**
- Modify: `runtime-api/server.mjs`

**Step 1: Write a failing test**

Add a lightweight unit-style test by introducing a helper function that can be imported, OR (simpler) add an internal counter for fetches behind a test env flag.

Recommended approach (low coupling):
1. Extract the snapshot builder into a module:
   - Create: `runtime-api/src/rooms/roomContext.mjs`
   - Create: `runtime-api/src/rooms/roomStreamPacket.mjs`
2. Export `buildRoomChatContext()` and `buildRoomStreamPacket()` with dependency injection.
3. Write tests for "only called once" using injected fake `getMarketOverviewSnapshot` and `getNewsDigestSnapshot`.

**Step 2: Implement extraction**

Module APIs:
```js
// runtime-api/src/rooms/roomContext.mjs
export async function buildRoomChatContext({ roomId, trader, latestDecision, nowMs, market, overview, digest }) {
  // compute readiness + symbolBrief
  // DO NOT fetch overview/digest here
}

// runtime-api/src/rooms/roomStreamPacket.mjs
export async function buildRoomStreamPacket({ roomId, decisionLimit, deps }) {
  // fetch overview/digest once
  // call buildRoomChatContext(...) with those results
}
```

Keep output schema unchanged.

**Step 3: Update server to use modules**

Update `runtime-api/server.mjs` to call the extracted builder.

**Step 4: Run tests**
```bash
cd runtime-api && npm test
```

**Commit**
```bash
git add runtime-api/server.mjs runtime-api/src/rooms/roomContext.mjs runtime-api/src/rooms/roomStreamPacket.mjs runtime-api/test/*.test.mjs
git commit -m "refactor(runtime): extract room stream packet builders and dedupe snapshots"
```

---

## Phase 5: Audit Explorer JSONL memory safety

### Task 5.1: Stream JSONL reads instead of loading whole file

**Why:** `readJsonlRecords()` uses `readFile()` then splits lines. For large day files, this can be slow and memory heavy.

**Files:**
- Modify: `runtime-api/server.mjs` (or move the reader into a module during Phase 4 extraction)

**Step 1: Add a focused test**

Add a unit test for a new helper `readJsonlRecordsStreaming(filePath, { limit, fromEnd })`.
- Create a temp JSONL file in test (use `fs/promises` in `runtime-api/test/...`).
- Assert it returns correct number of parsed objects and ignores malformed lines.

**Step 2: Implement streaming reader**

Implementation notes:
- Use `createReadStream()` and a simple line splitter.
- For `fromEnd: true`, you can:
  - either implement a tail-reader (more complex), or
  - accept a pragmatic approach: stream forward and keep a ring buffer of last N parsed records.

**Step 3: Wire it into existing endpoints**

Keep endpoint behavior unchanged:
- `GET /api/agents/:agentId/decision-audit/latest`
- `GET /api/agents/:agentId/decision-audit/day`

**Step 4: Run tests**
```bash
cd runtime-api && npm test
```

**Commit**
```bash
git add runtime-api/server.mjs runtime-api/test/*.test.mjs
git commit -m "refactor(runtime): stream decision audit JSONL reads"
```

---

## Phase 6: Web SSE wiring extraction (shrink App.tsx)

### Task 6.1: Extract room SSE logic into a hook

**Why:** `onlytrade-web/src/App.tsx` currently manages:
- EventSource connection + status tracking
- SWR cache updates for stream packets
- SWR cache updates for chat appends

This is correct behavior but hard to maintain.

**Files:**
- Create: `onlytrade-web/src/hooks/useRoomSse.ts`
- Modify: `onlytrade-web/src/App.tsx`

**Step 1: Create hook skeleton**

`useRoomSse({ roomId, decisionsLimit, enabled })` returns:
- `roomSseState`

Internals:
- open `EventSource` to `/api/rooms/:roomId/events?decision_limit=...`
- update SWR keys:
  - stream packet: the caller can pass a `onStreamPacket(packet)` callback, or hook can accept SWR mutate fns.
  - chat append: mutate `['room-public-chat', roomId]` using the existing `mergeChatMessages` logic.

**Step 2: Move `mergeChatMessages` into a shared util**

Create:
- `onlytrade-web/src/lib/chat/mergeChatMessages.ts`

So both App and hook can reuse it.

**Step 3: Update App.tsx to use the hook**

Delete the large `useEffect` SSE block and replace it with `useRoomSse(...)`.

**Step 4: Verify**
```bash
cd onlytrade-web && npm run build
```

Manual:
- open Room page and verify:
  - SSE status renders
  - chat messages appear immediately on append

**Commit**
```bash
git add onlytrade-web/src/hooks/useRoomSse.ts onlytrade-web/src/lib/chat/mergeChatMessages.ts onlytrade-web/src/App.tsx
git commit -m "refactor(web): extract room SSE wiring into hook"
```

---

## Phase 7: Streaming page performance/memory hardening

### Task 7.1: Bound danmu seen-set growth

**Files:**
- Modify: `onlytrade-web/src/pages/StreamingRoomPage.tsx`

**Step 1: Implement a capped structure**

Replace `seenRef: Set<string>` with:
- `seenSet` + `seenQueue` (array) capped to N (e.g. 500)

Algorithm:
- on add(id): if not present, add to set + push to queue
- if queue.length > N: shift old id and delete from set

**Step 2: Verify**
```bash
cd onlytrade-web && npm run build
```

**Commit**
```bash
git add onlytrade-web/src/pages/StreamingRoomPage.tsx
git commit -m "perf(web): cap danmu seen message ids"
```

### Task 7.2: Reduce canvas work when hidden/idle

**Files:**
- Modify: `onlytrade-web/src/pages/StreamingRoomPage.tsx`

Implement:
- pause RAF when `document.hidden`
- optionally throttle redraw when not speaking

Manual verify:
- background the tab and confirm CPU usage drops.

---

## Phase 8 (optional): Runtime SSE hub extraction

### Task 8.1: Extract SSE hub to `runtime-api/src/rooms/roomSseHub.mjs`

**Why:** `runtime-api/server.mjs` contains subscriber management, buffering, timers, and replay logic. Moving this to a module reduces risk of accidental regressions.

**Files:**
- Create: `runtime-api/src/rooms/roomSseHub.mjs`
- Modify: `runtime-api/server.mjs`
- Test: `runtime-api/test/roomEventsRoutes.test.mjs`

**Module responsibilities**
- `subscribe({ roomId, res, decisionLimit, packetIntervalMs, lastEventId })`
- `broadcast({ roomId, event, data, bufferPolicy })`
- `closeRoom(roomId)` cleanup

Keep the external behavior unchanged:
- per-room keepalive comments
- per-room shared packet timer
- replay on `Last-Event-ID`

Verification:
```bash
cd runtime-api && npm test
```

---

## Phase 9 (optional): Router single-source-of-truth

### Task 9.1: Remove manual `pushState/popstate` from `App.tsx` and use React Router

**Why:** The app currently mixes React Router (`BrowserRouter` + `useNavigate`) with manual history management in `onlytrade-web/src/App.tsx`. This increases the chance of route desync.

**Files:**
- Modify: `onlytrade-web/src/App.tsx`
- Modify: `onlytrade-web/src/components/HeaderBar.tsx`

Approach:
- Use `useLocation()` to derive current page
- Use `useNavigate()` for navigation
- Replace manual `route` state + `popstate` listener with router state

Verification:
- navigate between `/lobby`, `/room`, `/stream`, `/leaderboard`
- ensure `?trader=...` still selects trader

---

## Final verification checklist

Run:
```bash
cd runtime-api && npm test
cd onlytrade-web && npm test
cd onlytrade-web && npm run build
```

Manual:
- Open Room page: SSE status transitions; chat append arrives without refresh.
- Open Stream page: equity/unreal pnl/margin show correct numbers; danmu does not degrade over time.
- Audit explorer: day mode loads without UI freeze; download still works.

---

## Execution options

Plan complete and saved to `docs/plans/2026-02-16-sse-refactor-and-streaming-hardening.md`.

Two execution options:
1. Subagent-Driven (this session)
2. Parallel Session (separate)

Which approach?
