# Agent Registry Ops Runbook

## Scope

Operate folder-discovered agents with registry-backed lifecycle controls.

## Core flow: add -> register -> start

If `CONTROL_API_TOKEN` is configured, lifecycle mutating routes (`register/unregister/start/stop`) require a valid control token (`x-control-token` or bearer token).

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

## 5-room storytelling agents quick ops (`t_013`, `t_014`)

When story rooms are reachable but `/api/rooms/t_013/*` or `/api/rooms/t_014/*` return 404, the usual root cause is "folder missing on VM" or "not registered".

1. Ensure folders exist on target VM:

```bash
ls /opt/onlytrade/agents/t_013/agent.json
ls /opt/onlytrade/agents/t_014/agent.json
```

2. Register both agents:

```bash
bash scripts/onlytrade-ops.sh agent-register t_013
bash scripts/onlytrade-ops.sh agent-register t_014
```

3. Verify they are visible in traders list:

```bash
curl -fsS "http://127.0.0.1:8080/api/traders"
```

4. Verify room packets are available:

```bash
curl -fsS "http://127.0.0.1:8080/api/rooms/t_013/stream-packet?decision_limit=3"
curl -fsS "http://127.0.0.1:8080/api/rooms/t_014/stream-packet?decision_limit=3"
```
