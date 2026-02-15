# TODO: Room Realtime Chat via SSE + SSE Hardening + Audit Explorer UX

Goal: make the existing room page behave like a realtime console with minimal polling by extending `/api/rooms/:roomId/events` so **all** public chat (user + agent) and key room updates arrive via SSE, then updating the web UI to consume it. Keep everything debuggy; the dedicated phone-first "streaming-room" page is out of scope.

## Scope (in order)

1) Backend: emit SSE events for *all* public chat appends (user + agent)
2) Frontend: RoomPublicChatPanel becomes SSE-first (poll fallback only)
3) Optional: private chat SSE (decide later)
4) SSE hardening + observability in UI (connected/reconnecting)
5) Audit Explorer UX improvements (debug-friendly)

## 0) Baseline: confirm current behavior

- Existing SSE route: `runtime-api/server.mjs` has `GET /api/rooms/:roomId/events`
- SSE pushes (as of now):
  - `stream_packet` periodic timer
  - `decision` on runtime decisions
  - `chat_public_append` when POST `/api/chat/rooms/:roomId/messages` is called
- Stream packet REST: `GET /api/rooms/:roomId/stream-packet`
- Audit REST:
  - `GET /api/agents/:agentId/decision-audit/latest?limit=...`
  - `GET /api/agents/:agentId/decision-audit/day?day_key=YYYY-MM-DD&limit=...`

Verification:

- `npm --prefix runtime-api test`
- `npm --prefix onlytrade-web test`
- In browser DevTools Network, confirm `/api/rooms/<id>/events` stays open

## 1) Backend: broadcast agent-generated public chat messages too

Problem:

- Agent public messages can be created outside the POST endpoint:
  - proactive injection in `chatService.getPublicMessages()` (happens on reads)
  - decision narration appends to public chat store
- If those paths do not emit `chat_public_append`, the public chat panel still has to poll.

Desired behavior:

- Whenever a new public chat message is appended (user or agent), emit an SSE event:
  - `event: chat_public_append`
  - payload: `{ room_id, ts_ms, message, agent_reply? }`

Implementation tasks:

1.1 Add an event hook to chat layer

- Update `runtime-api/src/chat/chatService.mjs`:
  - Add optional callback in `createChatService` options:
    - `onPublicAppend?: (roomId: string, payload: { message: any, agent_reply?: any }) => void | Promise<void>`
  - Trigger it in:
    - `postMessage()` when appending public `userMessage` and/or `agentReply`
    - `maybeEmitProactivePublicMessage()` when appending proactive agent message
  - Best-effort only (try/catch around callback)

1.2 Wire callback in runtime-api server

- In `runtime-api/server.mjs` where `createChatService(...)` is called:
  - pass `onPublicAppend` that calls `broadcastRoomEvent(roomId, 'chat_public_append', payload)`

1.3 Ensure decision narration path emits chat append

- If narration uses `chatStore.appendPublic()` directly, either:
  - refactor to append through chatService, OR
  - broadcast `chat_public_append` immediately after successful append

Tests (runtime-api):

- Extend `runtime-api/test/roomEventsRoutes.test.mjs`:
  - connect to SSE
  - hit `/api/chat/rooms/:id/public` (should trigger proactive append)
  - wait for `event: chat_public_append`
- Add a test for narration append event (trigger a decision, or directly call the narration path if exposed)

Verification:

- `npm --prefix runtime-api test`
- Manual: open `/room`, wait for proactive/narration, confirm it appears without chat polling

## 2) Frontend: RoomPublicChatPanel becomes SSE-first

Problem:

- Public chat panel likely polls `/api/chat/rooms/:roomId/public` periodically.

Desired behavior:

- initial load via HTTP
- incremental updates via SSE `chat_public_append`
- slow fallback poll for resync only

Implementation tasks:

2.1 Add a small SSE consumer helper (optional)

- Create `onlytrade-web/src/lib/roomEvents.ts`:
  - `subscribeRoomEvents(roomId, decisionLimit, handlers)`
  - handles EventSource creation + cleanup
  - exposes connection state: `connected | connecting | error`

2.2 Update `onlytrade-web/src/components/chat/RoomPublicChatPanel.tsx`

- On mount:
  - load initial chat history via existing chat API
  - open EventSource to `/api/rooms/:roomId/events`
  - listen for `chat_public_append`:
    - append `message`
    - if payload includes `agent_reply`, append it too
    - dedupe by `message.id`
- Add fallback polling:
  - every 30-60s fetch latest messages and reconcile (dedupe)

2.3 UI connection indicator (debuggy)

- Show `SSE: connected/reconnecting` and last event time

Tests (onlytrade-web):

- Add a unit test for message merge/dedupe logic (pure function)
- Mock EventSource for minimal component test if needed

Verification:

- `npm --prefix onlytrade-web test`
- Manual:
  - send a public message; it should appear instantly
  - proactive/narration messages should appear instantly

## 3) Optional: Private chat SSE (defer unless needed)

Decision point:

- If you want private DM stream realtime too:
  - add SSE event `chat_private_append`
  - key by `(roomId, user_session_id)`
  - simplest: SSE URL includes `user_session_id` as query param
- Otherwise keep private chat polling.

## 4) SSE hardening (backend + frontend)

Backend:

- Add `id:` fields for events and support `Last-Event-ID` replay (optional)
- Maintain a small in-memory ring buffer of recent events per room (e.g. 200)
- Keepalive pings already exist; verify proxy behavior

Frontend:

- Show connection state
- Ensure parsing is guarded (try/catch JSON.parse)

Verification:

- Restart backend; UI should recover automatically

## 5) Audit Explorer UX upgrades (debuggy)

Current:

- `AuditExplorerPanel` shows latest records, expandable JSON, copy, refresh.

Next upgrades:

5.1 Day picker

- toggle between:
  - latest
  - a specific day (`/day?day_key=YYYY-MM-DD`)
- add "Download JSONL" (client-side) by joining records as JSON lines

5.2 Filters

- readiness level: OK/WARN/ERROR
- forced_hold only
- symbol contains

5.3 Link audit row to decision card

- locate a decision by `timestamp` or `cycle_number`
- scroll/highlight that decision card

## Commands checklist

- Backend tests: `npm --prefix runtime-api test`
- Web tests: `npm --prefix onlytrade-web test`
- Web build: `npm --prefix onlytrade-web run -s build`

## Notes / non-goals

- Do NOT implement the standalone projected "streaming-room" page yet.
- Keep UI debuggy; raw visibility over polish.
- Keep polling endpoints intact; SSE is additive and should degrade gracefully.
