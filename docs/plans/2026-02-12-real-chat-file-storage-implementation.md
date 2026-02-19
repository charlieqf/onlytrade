# Real Chat (File Storage) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement production-like room chat with persistent file storage for one-room-one-agent flows, supporting public plain messages, public mention-agent messages, and private user-agent messages without requiring login.

**Architecture:** Add a backend chat domain with append-only JSONL storage partitioned by room and visibility (`public` and per-user private threads). Route all chat writes through a validation service that enforces one-room-one-agent mention rules and no user-to-user mentions. Replace frontend local demo room events with two real chat channels (Public + Private) backed by polling APIs and anonymous `user_session_id` persistence.

**Tech Stack:** Node.js (Express, node:test), React + SWR + TypeScript, JSONL file storage under `data/chat`, browser `localStorage` for anonymous session identity.

---

### Task 1: Define chat domain contract and persistence layout

**Files:**
- Create: `docs/architecture/room-chat-file-contract.md`
- Modify: `README.md`
- Test: `runtime-api/test/chatContract.test.mjs`

**Step 1: Write the failing test**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { validateMessageType } from '../src/chat/chatContract.mjs'

test('chat contract supports only three message types', () => {
  assert.equal(validateMessageType('public_plain'), true)
  assert.equal(validateMessageType('public_mention_agent'), true)
  assert.equal(validateMessageType('private_agent_dm'), true)
  assert.equal(validateMessageType('public_mention_user'), false)
})
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix runtime-api test -- chatContract.test.mjs`
Expected: FAIL with module not found for `chatContract.mjs`.

**Step 3: Write minimal implementation**

Create `runtime-api/src/chat/chatContract.mjs`:

```js
const MESSAGE_TYPES = new Set(['public_plain', 'public_mention_agent', 'private_agent_dm'])

export function validateMessageType(messageType) {
  return MESSAGE_TYPES.has(String(messageType || '').trim())
}

export function chatStoragePaths(roomId, userSessionId) {
  return {
    publicPath: `data/chat/rooms/${roomId}/public.jsonl`,
    privatePath: `data/chat/rooms/${roomId}/dm/${userSessionId}.jsonl`,
  }
}
```

**Step 4: Document contract**

In `docs/architecture/room-chat-file-contract.md`, define:
- one-room-one-agent invariant (`room_id == trader_id`)
- message schema
- storage paths
- mention validation rules

**Step 5: Run test to verify it passes**

Run: `npm --prefix runtime-api test -- chatContract.test.mjs`
Expected: PASS.

**Step 6: Commit**

```bash
git add docs/architecture/room-chat-file-contract.md README.md runtime-api/src/chat/chatContract.mjs runtime-api/test/chatContract.test.mjs
git commit -m "feat: define room chat contract and file layout"
```

---

### Task 2: Implement append-only file chat store (public + private)

**Files:**
- Create: `runtime-api/src/chat/chatFileStore.mjs`
- Test: `runtime-api/test/chatFileStore.test.mjs`

**Step 1: Write the failing test**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatFileStore } from '../src/chat/chatFileStore.mjs'

test('chat store appends and reads public/private history', async () => {
  const store = createChatFileStore({ baseDir: './tmp-chat-test' })
  await store.appendPublic('t_001', { id: 'm1', text: 'hello' })
  await store.appendPrivate('t_001', 'usr_sess_1', { id: 'm2', text: 'hi agent' })
  const pub = await store.readPublic('t_001', 20)
  const priv = await store.readPrivate('t_001', 'usr_sess_1', 20)
  assert.equal(pub.length, 1)
  assert.equal(priv.length, 1)
})
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix runtime-api test -- chatFileStore.test.mjs`
Expected: FAIL.

**Step 3: Write minimal implementation**

In `chatFileStore.mjs` implement:
- `appendPublic(roomId, message)`
- `appendPrivate(roomId, userSessionId, message)`
- `readPublic(roomId, limit, beforeTsMs)`
- `readPrivate(roomId, userSessionId, limit, beforeTsMs)`
- `ensureDir + appendFile + readFile` with line-by-line JSON parse

Use append-only JSONL (one message per line).

**Step 4: Add corruption tolerance**

Ignore malformed lines during reads and continue parsing remaining valid lines.

**Step 5: Run test to verify it passes**

Run: `npm --prefix runtime-api test -- chatFileStore.test.mjs`
Expected: PASS.

**Step 6: Commit**

```bash
git add runtime-api/src/chat/chatFileStore.mjs runtime-api/test/chatFileStore.test.mjs
git commit -m "feat: add append-only file chat store for room public and private threads"
```

---

### Task 3: Implement chat service validation and routing rules

**Files:**
- Create: `runtime-api/src/chat/chatService.mjs`
- Test: `runtime-api/test/chatService.test.mjs`

**Step 1: Write the failing test (mention rules)**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatService } from '../src/chat/chatService.mjs'

test('rejects mention targets other than room agent', async () => {
  const svc = createChatService({ /* inject fake store + room resolver */ })
  await assert.rejects(
    () => svc.postMessage({
      roomId: 't_001',
      userSessionId: 'usr_sess_1',
      visibility: 'public',
      text: '@john hi',
      messageType: 'public_mention_agent',
    }),
    /invalid_mention_target/
  )
})
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix runtime-api test -- chatService.test.mjs`
Expected: FAIL.

**Step 3: Write minimal implementation**

In `chatService.mjs` implement:
- `postMessage(...)` with validation:
  - message type in allowed set
  - text length <= `CHAT_MAX_TEXT_LEN`
  - room exists and has one agent (`roomId` resolves to trader)
  - only allowed mention token is `@agent` (or exact room agent handle)
  - reject any other mention token (`@\w+`) as `invalid_mention_target`
- route write target:
  - `public_*` -> public file
  - `private_agent_dm` -> private file for `user_session_id`

**Step 4: Add lightweight rate limit**

In-memory guard by `(roomId, userSessionId)` with default `CHAT_RATE_LIMIT_PER_MIN=20`.

**Step 5: Run tests**

Run: `npm --prefix runtime-api test -- chatService.test.mjs`
Expected: PASS.

**Step 6: Commit**

```bash
git add runtime-api/src/chat/chatService.mjs runtime-api/test/chatService.test.mjs
git commit -m "feat: enforce one-room-one-agent chat routing and mention validation"
```

---

### Task 4: Implement agent reply policy for three message types

**Files:**
- Create: `runtime-api/src/chat/chatAgentResponder.mjs`
- Modify: `runtime-api/src/chat/chatService.mjs`
- Test: `runtime-api/test/chatAgentResponder.test.mjs`

**Step 1: Write the failing test**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldAgentReply } from '../src/chat/chatAgentResponder.mjs'

test('agent reply policy by message type', () => {
  assert.equal(shouldAgentReply({ messageType: 'public_mention_agent' }), true)
  assert.equal(shouldAgentReply({ messageType: 'private_agent_dm' }), true)
  assert.equal(shouldAgentReply({ messageType: 'public_plain', random: 0.99, threshold: 0.1 }), false)
})
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix runtime-api test -- chatAgentResponder.test.mjs`
Expected: FAIL.

**Step 3: Write minimal implementation**

In `chatAgentResponder.mjs` implement:
- `shouldAgentReply({ messageType, random, threshold })`
- `buildAgentReply({ roomAgent, inboundMessage, latestDecision })`

Policy:
- mention/private: always reply
- plain public: reply probabilistically (`CHAT_PUBLIC_PLAIN_REPLY_RATE`, default `0.05`)

**Step 4: Integrate responder in service**

After user message write:
- optionally create agent reply message
- write to same visibility channel (public or private)

**Step 5: Run tests**

Run: `npm --prefix runtime-api test -- chatAgentResponder.test.mjs`
Expected: PASS.

**Step 6: Commit**

```bash
git add runtime-api/src/chat/chatAgentResponder.mjs runtime-api/src/chat/chatService.mjs runtime-api/test/chatAgentResponder.test.mjs
git commit -m "feat: add agent reply policy for public mention and private dm"
```

---

### Task 5: Add backend chat APIs and anonymous session bootstrap

**Files:**
- Modify: `runtime-api/server.mjs`
- Test: `runtime-api/test/chatRoutes.test.mjs`

**Step 1: Write the failing route test**

```js
import test from 'node:test'
import assert from 'node:assert/strict'

test('POST /api/chat/session/bootstrap returns user_session_id', async () => {
  const res = await fetch('http://127.0.0.1:18081/api/chat/session/bootstrap', { method: 'POST' })
  const body = await res.json()
  assert.equal(body.success, true)
  assert.ok(body.data.user_session_id)
})
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix runtime-api test -- chatRoutes.test.mjs`
Expected: FAIL (route missing).

**Step 3: Implement routes**

Add endpoints in `server.mjs`:
- `POST /api/chat/session/bootstrap`
- `GET /api/chat/rooms/:roomId/public?limit=&before_ts_ms=`
- `GET /api/chat/rooms/:roomId/private?user_session_id=&limit=&before_ts_ms=`
- `POST /api/chat/rooms/:roomId/messages`

Body for post:

```json
{
  "user_session_id": "usr_sess_xxx",
  "visibility": "public|private",
  "message_type": "public_plain|public_mention_agent|private_agent_dm",
  "text": "..."
}
```

**Step 4: Run tests**

Run: `npm --prefix runtime-api test -- chatRoutes.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git add runtime-api/server.mjs runtime-api/test/chatRoutes.test.mjs
git commit -m "feat: expose room chat APIs and anonymous chat session bootstrap"
```

---

### Task 6: Add frontend chat types and API client methods

**Files:**
- Modify: `onlytrade-web/src/types.ts`
- Modify: `onlytrade-web/src/lib/api.ts`
- Test: `onlytrade-web/src/lib/chatApi.test.ts`

**Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest'
import { api } from './api'

describe('chat api', () => {
  it('exposes room chat methods', () => {
    expect(typeof api.bootstrapChatSession).toBe('function')
    expect(typeof api.getRoomPublicMessages).toBe('function')
    expect(typeof api.getRoomPrivateMessages).toBe('function')
    expect(typeof api.postRoomMessage).toBe('function')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix onlytrade-web test -- src/lib/chatApi.test.ts`
Expected: FAIL.

**Step 3: Implement minimal types + api methods**

Add types:
- `ChatMessage`
- `ChatVisibility`
- `ChatMessageType`

Add API methods:
- `bootstrapChatSession()`
- `getRoomPublicMessages(roomId, limit)`
- `getRoomPrivateMessages(roomId, userSessionId, limit)`
- `postRoomMessage(roomId, payload)`

**Step 4: Run test to verify it passes**

Run: `npm --prefix onlytrade-web test -- src/lib/chatApi.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add onlytrade-web/src/types.ts onlytrade-web/src/lib/api.ts onlytrade-web/src/lib/chatApi.test.ts
git commit -m "feat: add frontend room chat api client and types"
```

---

### Task 7: Replace demo room events with two real chat windows

**Files:**
- Create: `onlytrade-web/src/components/chat/RoomPublicChatPanel.tsx`
- Create: `onlytrade-web/src/components/chat/RoomPrivateChatPanel.tsx`
- Create: `onlytrade-web/src/hooks/useUserSessionId.ts`
- Modify: `onlytrade-web/src/pages/TraderDashboardPage.tsx`
- Test: `onlytrade-web/src/components/chat/RoomChatPanels.test.tsx`

**Step 1: Write failing component test**

```tsx
import { render, screen } from '@testing-library/react'
import { RoomPublicChatPanel } from './RoomPublicChatPanel'

test('renders public and private channel labels', () => {
  render(<RoomPublicChatPanel roomId="t_001" userSessionId="usr_sess_1" />)
  expect(screen.getByText(/Public/i)).toBeInTheDocument()
})
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix onlytrade-web test -- src/components/chat/RoomChatPanels.test.tsx`
Expected: FAIL.

**Step 3: Implement session id hook**

`useUserSessionId.ts`:
- load `user_session_id` from localStorage
- if missing call `api.bootstrapChatSession()` and persist

**Step 4: Implement two channel panels**

Public panel:
- list + composer for `public_plain` and `public_mention_agent`

Private panel:
- list + composer for `private_agent_dm`

**Step 5: Integrate into TraderDashboardPage**

Replace local `roomEvents` demo block with tabs:
- `Public`
- `Private`

Use `roomId = selectedTrader.trader_id`.

**Step 6: Run tests + build**

Run:

```bash
npm --prefix onlytrade-web test -- src/components/chat/RoomChatPanels.test.tsx
npm --prefix onlytrade-web run build
```

Expected: PASS.

**Step 7: Commit**

```bash
git add onlytrade-web/src/components/chat/RoomPublicChatPanel.tsx onlytrade-web/src/components/chat/RoomPrivateChatPanel.tsx onlytrade-web/src/hooks/useUserSessionId.ts onlytrade-web/src/pages/TraderDashboardPage.tsx onlytrade-web/src/components/chat/RoomChatPanels.test.tsx
git commit -m "feat: add two-channel room chat ui with anonymous session identity"
```

---

### Task 8: Ops, monitoring, and acceptance checks

**Files:**
- Modify: `scripts/onlytrade-ops.sh`
- Create: `docs/runbooks/room-chat-live-ops.md`
- Modify: `README.md`
- Test: manual API verification

**Step 1: Add ops helpers**

In `scripts/onlytrade-ops.sh` add:
- `chat-status <room_id> [user_session_id]`
- `chat-tail-public <room_id>`
- `chat-tail-private <room_id> <user_session_id>`

**Step 2: Write runbook**

`docs/runbooks/room-chat-live-ops.md` should include:
- preflight
- message path checks
- mention-validation troubleshooting
- stale/no-response incident steps

**Step 3: Verify manually**

Run:

```bash
curl -fsS -X POST "$API_BASE/api/chat/session/bootstrap"
curl -fsS "$API_BASE/api/chat/rooms/t_001/public?limit=20"
curl -fsS "$API_BASE/api/chat/rooms/t_001/private?user_session_id=<id>&limit=20"
curl -fsS -X POST "$API_BASE/api/chat/rooms/t_001/messages" -H "Content-Type: application/json" -d '{"user_session_id":"<id>","visibility":"public","message_type":"public_mention_agent","text":"@agent why trim today?"}'
```

Expected:
- public mention is accepted and agent reply appears in public timeline
- invalid mention like `@john` is rejected with `invalid_mention_target`

**Step 4: Commit**

```bash
git add scripts/onlytrade-ops.sh docs/runbooks/room-chat-live-ops.md README.md
git commit -m "docs: add room chat ops runbook and diagnostics commands"
```

---

## Final validation matrix

1. Backend tests:

```bash
npm --prefix runtime-api test
```

2. Frontend tests/build:

```bash
npm --prefix onlytrade-web test
npm --prefix onlytrade-web run build
```

3. Scenario checks:
- public plain message (agent usually no response)
- public mention message (agent response in public)
- private dm (response only in private)
- non-agent mention rejected
- refresh page preserves private history via same `user_session_id`

4. VM dry run:
- deploy
- verify file growth under `data/chat/rooms/<room_id>/...`
- verify no login required for chat posting/reading.
