# 24x7 Agent and Room Lifecycle Design

## Goal

Run OnlyTrade continuously with dynamic agent onboarding/offboarding and room open/close without restarting the backend.

## Core Model

- `Agent`: logical trader definition + runtime status.
- `Room`: streaming surface bound to one active agent session (or a portfolio of agents later).
- `AgentSession`: one runtime instance for one agent in one room.
- `StreamSession`: one client connection (SSE/WebSocket) attached to a room.

## State Machines

### Agent

- `PENDING_REGISTRATION` -> `REGISTERED` -> `ACTIVE` -> `PAUSED` -> `TERMINATED`
- Terminal: `TERMINATED`.
- Self-registration timeout: if no heartbeat within lease window, auto-transition to `PAUSED`.

### Room

- `CREATED` -> `OPEN` -> `DRAINING` -> `CLOSED`
- `DRAINING` means no new stream sessions, existing sessions get shutdown event and grace timeout.

## Services

1. `AgentRegistryService`
   - Source of truth for agent metadata and lifecycle.
   - Supports admin registration and agent self-registration.
   - Maintains lease/heartbeat (`last_seen_at`, `lease_expires_at`).

2. `RoomRegistryService`
   - Maps rooms to active `agent_session_id`.
   - Handles room open/close and guards against duplicate room ownership.

3. `AgentRuntimeOrchestrator`
   - Starts/stops runtime loops by `agent_session_id`.
   - Enforces global controls (kill switch, cadence, rate limits).

4. `StreamGateway`
   - Manages SSE/WebSocket sessions by room.
   - Emits lifecycle events (`room.opened`, `room.draining`, `room.closed`, `agent.paused`).

## API Contract (v1)

- `POST /api/agents` (admin register)
- `POST /api/agents/self-register` (agent bootstrap token)
- `POST /api/agents/:id/heartbeat`
- `POST /api/agents/:id/pause`
- `POST /api/agents/:id/resume`
- `POST /api/agents/:id/terminate`
- `POST /api/rooms`
- `POST /api/rooms/:id/open`
- `POST /api/rooms/:id/drain`
- `POST /api/rooms/:id/close`
- `GET /api/rooms/:id/stream`

All mutation endpoints should be idempotent via `Idempotency-Key`.

## Data Persistence

Use durable tables (or JSON files in mock mode) for:

- `agents`
- `agent_sessions`
- `rooms`
- `stream_sessions`
- `lifecycle_events` (append-only audit log)

## Operational Guarantees

- No orphan runtime loops: periodic reconciler stops sessions whose room is `CLOSED` or lease expired.
- No zombie rooms: room auto-closes when zero stream sessions for configurable idle timeout.
- Safe termination: `terminate` transitions room to `DRAINING`, flushes final snapshot, then `CLOSED`.

## Security

- Admin APIs require control token/JWT role.
- Self-registration requires short-lived bootstrap token scoped to agent template.
- Heartbeat tokens rotated per agent session.

## Recommended Rollout

1. Introduce `AgentRegistryService` and `RoomRegistryService` with in-memory store + JSON persistence.
2. Move static `TRADERS` to registry-backed dynamic list.
3. Bind runtime scheduling to `agent_sessions` instead of fixed array.
4. Add room drain/close semantics to stream endpoint.
5. Add heartbeat lease expiry and reconciler loop.
6. Add metrics/alerts for `active_agents`, `active_rooms`, `orphan_sessions`, `stream_clients`.
