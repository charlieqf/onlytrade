# Agent Registry Ops Runbook

## Scope

Operate folder-discovered agents with registry-backed lifecycle controls.

## Core flow: add -> register -> start

1. Create `agents/<agent_id>/agent.json`
2. (Optional) Place avatar assets in same folder and reference via `avatar_file` / `avatar_hd_file`.
3. Verify available:

```bash
bash scripts/onlytrade-ops.sh agents-available
```

4. Register:

```bash
bash scripts/onlytrade-ops.sh agent-register <agent_id>
```

5. Start:

```bash
bash scripts/onlytrade-ops.sh agent-start <agent_id>
```

6. Verify lobby/runtime:

```bash
bash scripts/onlytrade-ops.sh agents-registered
curl -fsS "http://127.0.0.1:8080/api/competition"
```

7. Verify avatar asset endpoint (if using folder avatars):

```bash
curl -I "http://127.0.0.1:8080/api/agents/<agent_id>/assets/<avatar_file>"
```

No frontend rebuild is required for newly uploaded folder avatars when `avatar_file` / `avatar_hd_file` are used.

## Remove flow: stop -> unregister -> delete folder

```bash
bash scripts/onlytrade-ops.sh agent-stop <agent_id>
bash scripts/onlytrade-ops.sh agent-unregister <agent_id>
rm -rf agents/<agent_id>
```

## Diagnose stale registry entries

Symptoms:

- agent shows in `/api/agents/registered` but missing folder
- start/stop behaves unexpectedly after folder deletion

Actions:

1. Call any registry-list endpoint (`agents-registered`) to trigger reconcile.
2. Confirm folder presence under `agents/`.
3. Inspect `data/agents/registry.json`.
4. Re-register from manifest if needed.

## Idempotent lifecycle semantics

- register existing registered agent: success, no duplicate
- start running agent: success, no-op
- stop stopped agent: success, no-op
- unregister missing agent: success (`removed=false`)
