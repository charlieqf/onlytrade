# Folder/Registry Agent Discovery and Lobby Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace hardcoded trader agents with folder-discovered agents and registry-managed lobby membership, with per-agent `running|stopped` status and register/unregister/start/stop control interfaces.

**Architecture:** Use a two-layer model: `available agents` are discovered from `agents/<agent_id>/agent.json`, while `registered agents` are persisted in `data/agents/registry.json` and define lobby visibility. Runtime loops execute only registered+running agents. Keep backward compatibility for existing frontend by preserving `/api/traders` and `/api/competition` response shapes while sourcing from registry.

**Tech Stack:** Node.js (Express, node:test), filesystem JSON persistence (`fs/promises`), existing in-memory runtime (`createInMemoryAgentRuntime`), React frontend (Lobby page), shell ops CLI (`scripts/onlytrade-ops.sh`).

---

### Task 1: Define file contracts for available/registered agents

**Files:**
- Create: `docs/architecture/agent-folder-registry-contract.md`
- Create: `agents/README.md`
- Modify: `README.md`
- Test: `mock-api/test/agentRegistryStore.test.mjs`

**Step 1: Write the failing test**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createAgentRegistryStore } from '../src/agentRegistryStore.mjs'

test('discovers available agents from agents/*/agent.json', async () => {
  const store = createAgentRegistryStore({
    agentsDir: './test/tmp-agents',
    registryPath: './test/tmp-registry/registry.json',
  })
  const available = await store.listAvailableAgents()
  assert.equal(Array.isArray(available), true)
})
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix mock-api test -- test/agentRegistryStore.test.mjs`
Expected: FAIL with module-not-found for `agentRegistryStore.mjs`.

**Step 3: Write contract doc first**

In `docs/architecture/agent-folder-registry-contract.md` define:
- `agents/<agent_id>/agent.json` schema (`agent_id`, `agent_name`, `ai_model`, `exchange_id`, optional metadata)
- `data/agents/registry.json` schema (`registered_at`, `status`, `show_in_lobby`, `last_started_at`, `last_stopped_at`)
- invariants:
  - available = folder exists + valid manifest
  - registered subset of available
  - lobby list = registered where `show_in_lobby=true`
  - status enum = `running|stopped`

**Step 4: Document folder usage**

In `agents/README.md` include:
- how to add agent folder
- minimal `agent.json` template
- naming constraints for `agent_id`

**Step 5: Run test (still expected fail at implementation stage)**

Run: `npm --prefix mock-api test -- test/agentRegistryStore.test.mjs`
Expected: still FAIL until store implementation (Task 2).

**Step 6: Commit docs scaffold**

```bash
git add docs/architecture/agent-folder-registry-contract.md agents/README.md README.md mock-api/test/agentRegistryStore.test.mjs
git commit -m "docs: define folder and registry contract for agent discovery"
```

---

### Task 2: Implement filesystem-backed agent registry store

**Files:**
- Create: `mock-api/src/agentRegistryStore.mjs`
- Modify: `mock-api/test/agentRegistryStore.test.mjs`

**Step 1: Expand failing tests for core behaviors**

Add tests for:
- list available agents from subfolders
- register/unregister updates registry JSON
- start/stop transitions are idempotent
- register fails when folder/manifest missing
- reconcile removes stale registrations when folder deleted

**Step 2: Run tests to verify failures**

Run: `npm --prefix mock-api test -- test/agentRegistryStore.test.mjs`
Expected: FAIL on missing methods and wrong state transitions.

**Step 3: Write minimal implementation**

Implement `createAgentRegistryStore({...})` with:
- `listAvailableAgents()` (scan `agents/*/agent.json`)
- `listRegisteredAgents()`
- `registerAgent(agentId)`
- `unregisterAgent(agentId)`
- `startAgent(agentId)`
- `stopAgent(agentId)`
- `reconcile()`

Implementation details:
- atomic writes for `registry.json` (temp file + rename)
- default new registration: `status='stopped'`, `show_in_lobby=true`
- idempotent start/stop behavior

**Step 4: Run tests to verify pass**

Run: `npm --prefix mock-api test -- test/agentRegistryStore.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git add mock-api/src/agentRegistryStore.mjs mock-api/test/agentRegistryStore.test.mjs
git commit -m "feat: add folder discovery and registry-backed agent state store"
```

---

### Task 3: Make runtime support dynamic registered/running agent sets

**Files:**
- Modify: `mock-api/src/agentDecisionRuntime.mjs`
- Modify: `mock-api/test/agentDecisionRuntime.test.mjs`

**Step 1: Write failing runtime test**

Add test:
- runtime supports replacing trader set at runtime (add/remove)
- only evaluates traders in current set

Example assertion flow:
- start runtime with `t_001`
- `setTraders([t_001, t_002])` then `stepOnce()`
- verify call counts include both
- `setTraders([t_002])` then `stepOnce()`
- verify `t_001` no longer increments

**Step 2: Run test to verify it fails**

Run: `npm --prefix mock-api test -- test/agentDecisionRuntime.test.mjs`
Expected: FAIL due to missing `setTraders`/dynamic map behavior.

**Step 3: Implement minimal runtime extension**

In `createInMemoryAgentRuntime`:
- store traders in mutable map/list (not fixed array only)
- add method `setTraders(nextTraders)`
- initialize missing decision/call maps for new traders
- remove stale trader map entries for deleted traders

**Step 4: Run test to verify pass**

Run: `npm --prefix mock-api test -- test/agentDecisionRuntime.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git add mock-api/src/agentDecisionRuntime.mjs mock-api/test/agentDecisionRuntime.test.mjs
git commit -m "feat: support dynamic trader sets in in-memory runtime"
```

---

### Task 4: Replace hardcoded TRADERS in server with available+registered store

**Files:**
- Modify: `mock-api/server.mjs`
- Create: `mock-api/test/agentManagementRoutes.test.mjs`
- Modify: `mock-api/test/runtimeMode.test.mjs` (if assumptions on static traders exist)

**Step 1: Write failing route tests**

Add tests for:
- `GET /api/agents/available`
- `GET /api/agents/registered`
- `POST /api/agents/:id/register`
- `POST /api/agents/:id/unregister`
- `POST /api/agents/:id/start`
- `POST /api/agents/:id/stop`

Also assert:
- `/api/traders` returns registered agents only
- `/api/competition` returns registered agents only with `is_running` from registry

**Step 2: Run tests to verify they fail**

Run: `npm --prefix mock-api test -- test/agentManagementRoutes.test.mjs`
Expected: FAIL with 404 for missing endpoints and static payload mismatches.

**Step 3: Implement registry wiring in server**

In `server.mjs`:
- instantiate `agentRegistryStore`
- derive `availableAgents`, `registeredAgents`, `runningAgentIds`
- add helper `refreshAgentState()` that:
  - scans available
  - reconciles registry
  - updates runtime traders via `agentRuntime.setTraders(...)`

Add API endpoints listed above.

Keep backward-compatible endpoints:
- `/api/traders` -> registered agents
- `/api/competition` -> registered agents with current runtime/account overlays

**Step 4: Ensure start/stop semantics**

- `start` requires registered agent
- `stop` requires registered agent
- both idempotent
- `unregister` auto-stops if running (or reject with clear error; choose one and keep documented)

**Step 5: Run tests to verify pass**

Run: `npm --prefix mock-api test -- test/agentManagementRoutes.test.mjs`
Expected: PASS.

**Step 6: Commit**

```bash
git add mock-api/server.mjs mock-api/test/agentManagementRoutes.test.mjs mock-api/test/runtimeMode.test.mjs
git commit -m "feat: add folder-registry agent management APIs and registry-backed trader endpoints"
```

---

### Task 5: Seed default agent manifests and initial registry

**Files:**
- Create: `agents/t_001/agent.json`
- Create: `agents/t_002/agent.json`
- Create: `agents/t_003/agent.json`
- Create: `agents/t_004/agent.json`
- Create: `data/agents/registry.json`

**Step 1: Write failing bootstrap test**

In `mock-api/test/agentManagementRoutes.test.mjs`, assert server boot with empty registry still discovers available agents from folder and can register them.

**Step 2: Run test to verify failure**

Run: `npm --prefix mock-api test -- test/agentManagementRoutes.test.mjs`
Expected: FAIL if manifests missing.

**Step 3: Add manifests and registry seed**

Manifest minimal example:

```json
{
  "agent_id": "t_001",
  "agent_name": "HS300 Momentum",
  "ai_model": "qwen",
  "exchange_id": "sim-cn",
  "strategy_name": "Momentum + trend confirmation"
}
```

Registry seed example:

```json
{
  "schema_version": "agent.registry.v1",
  "agents": {}
}
```

**Step 4: Run tests to verify pass**

Run: `npm --prefix mock-api test -- test/agentManagementRoutes.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git add agents/t_001/agent.json agents/t_002/agent.json agents/t_003/agent.json agents/t_004/agent.json data/agents/registry.json
git commit -m "chore: add default agent manifests and registry seed"
```

---

### Task 6: Show running/stopped status in Lobby cards

**Files:**
- Modify: `onlytrade-web/src/pages/LobbyPage.tsx`
- Modify: `onlytrade-web/src/types.ts`
- Create: `onlytrade-web/src/pages/LobbyPage.test.tsx`

**Step 1: Write failing UI test**

Test that lobby card renders one of:
- `Running` / `运行中`
- `Stopped` / `已停止`

based on `competition.traders[i].is_running`.

**Step 2: Run test to verify it fails**

Run: `npm --prefix onlytrade-web test -- src/pages/LobbyPage.test.tsx`
Expected: FAIL (status badge absent).

**Step 3: Implement minimal UI update**

In `LobbyPage.tsx`:
- add status badge per card
- color code running/stopped

No routing changes required.

**Step 4: Run test to verify pass**

Run: `npm --prefix onlytrade-web test -- src/pages/LobbyPage.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add onlytrade-web/src/pages/LobbyPage.tsx onlytrade-web/src/types.ts onlytrade-web/src/pages/LobbyPage.test.tsx
git commit -m "feat: show per-agent running status on lobby room cards"
```

---

### Task 7: Add ops commands for register/unregister/start/stop/list

**Files:**
- Modify: `scripts/onlytrade-ops.sh`
- Create: `docs/runbooks/agent-registry-ops.md`
- Modify: `README.md`

**Step 1: Add command help entries**

Add commands:
- `agents-available`
- `agents-registered`
- `agent-register <agent_id>`
- `agent-unregister <agent_id>`
- `agent-start <agent_id>`
- `agent-stop <agent_id>`

**Step 2: Implement command handlers**

Use curl wrappers to call:
- `GET /api/agents/available`
- `GET /api/agents/registered`
- `POST /api/agents/:id/register`
- `POST /api/agents/:id/unregister`
- `POST /api/agents/:id/start`
- `POST /api/agents/:id/stop`

**Step 3: Add runbook and README section**

Document common flows:
- add folder -> register -> start
- stop -> unregister -> delete folder
- diagnose stale registry entries

**Step 4: Manual verify commands**

Run:

```bash
bash scripts/onlytrade-ops.sh agents-available
bash scripts/onlytrade-ops.sh agents-registered
bash scripts/onlytrade-ops.sh agent-register t_001
bash scripts/onlytrade-ops.sh agent-start t_001
bash scripts/onlytrade-ops.sh agent-stop t_001
bash scripts/onlytrade-ops.sh agent-unregister t_001
```

Expected: success responses and state transitions.

**Step 5: Commit**

```bash
git add scripts/onlytrade-ops.sh docs/runbooks/agent-registry-ops.md README.md
git commit -m "feat: add ops commands and runbook for folder-registry agent lifecycle"
```

---

### Task 8: End-to-end compatibility and regression checks

**Files:**
- Modify: `mock-api/test/chatRoutes.test.mjs` (if room validation now checks registered agents)
- Modify: `mock-api/test/runtimeMode.test.mjs` (if trader source changed)
- Modify: `onlytrade-web/src/lib/chatApi.test.ts` (if API typing changed)

**Step 1: Run full backend suite**

Run: `npm --prefix mock-api test`
Expected: PASS all tests including new management and existing chat/runtime tests.

**Step 2: Run full frontend suite**

Run: `npm --prefix onlytrade-web test`
Expected: PASS.

**Step 3: Run frontend build**

Run: `npm --prefix onlytrade-web run build`
Expected: PASS.

**Step 4: Manual scenario matrix**

- add folder `agents/t_xxx/agent.json`
- register -> appears in lobby
- start -> lobby status `running`
- stop -> lobby status `stopped`
- unregister -> removed from lobby
- delete folder -> no longer appears in available

**Step 5: Final commit**

```bash
git add mock-api/test/chatRoutes.test.mjs mock-api/test/runtimeMode.test.mjs onlytrade-web/src/lib/chatApi.test.ts
git commit -m "test: cover folder-registry agent lifecycle compatibility"
```

---

## Final validation matrix

1. Backend:

```bash
npm --prefix mock-api test
```

2. Frontend:

```bash
npm --prefix onlytrade-web test
npm --prefix onlytrade-web run build
```

3. API behavior:
- `GET /api/agents/available` reflects `agents/` subfolders
- `GET /api/agents/registered` reflects `data/agents/registry.json`
- lobby list endpoints show registered agents only
- per-agent status is `running|stopped`

4. Ops behavior:
- CLI register/unregister/start/stop commands are idempotent and consistent with API state.
