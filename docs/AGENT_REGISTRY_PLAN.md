# Agent Registry + Filesystem Ownership Plan

## Goal

Move agent management from hardcoded lists to a file-backed model where each agent is a folder with JSON state + avatar assets, and a central registry JSON tracks active agents.

Target outcomes:

- Admin and regular users can create/edit/remove agents from UI.
- Agent runtime reads from registry data (not hardcoded constants).
- Prompt/strategy/avatar edits persist to disk.
- Competition and room APIs reflect registry state in near-real-time.

## Scope

In scope:

- Data model and file layout
- Role/permission model
- CRUD + prompt/avatar APIs
- Runtime integration with replay/decision/memory
- UI flows for admin vs regular users
- Migration from current hardcoded traders
- Validation, safety, test plan

Out of scope (phase later):

- Full database migration
- Object storage/CDN for avatars
- Multi-node distributed locking

## Filesystem Data Model

Root directory:

- `data/agents/registry.json`
- `data/agents/<agent_id>/profile.json`
- `data/agents/<agent_id>/prompt.json`
- `data/agents/<agent_id>/memory.json`
- `data/agents/<agent_id>/daily_journal.jsonl`
- `data/agents/<agent_id>/decisions.jsonl`
- `data/agents/<agent_id>/avatar.<ext>`

### Registry Schema (`agents.registry.v1`)

```json
{
  "schema_version": "agents.registry.v1",
  "next_id": 5,
  "updated_at": "2026-02-12T12:00:00.000Z",
  "agents": [
    {
      "agent_id": "a_001",
      "trader_id": "t_001",
      "name": "HS300 Momentum",
      "owner_user_id": "admin",
      "visibility": "public",
      "status": "active",
      "avatar_path": "data/agents/a_001/avatar.jpg",
      "created_at": "2026-02-12T12:00:00.000Z",
      "updated_at": "2026-02-12T12:00:00.000Z"
    }
  ]
}
```

### Profile Schema (`agent.profile.v1`)

Contains runtime-facing identity and controls:

- `trader_id`, `trader_name`, `ai_model`, `exchange_id`
- `strategy_name`, `risk_profile`, `show_in_competition`, `is_running`
- `market`, `symbol_universe`, `decision_every_bars`

### Prompt Schema (`agent.prompt.v1`)

Layered prompt model:

- `universal_instruction` (shared baseline)
- `style_instruction` (agent personality/mental model)
- `custom_instruction` (owner editable)
- `updated_by`, `updated_at`

### Memory Schema (`agent.memory.v2`)

Reuse current structure already in repo:

- `meta`, `config`, `replay`, `stats`, `daily_journal`, `holdings`, `recent_actions`

## Roles and Permissions

Roles:

- `admin`
- `user`
- `viewer` (implicit/public)

Rules:

- Admin can create/edit/delete any agent and toggle competition visibility.
- User can create/edit/archive only owned agents.
- User cannot hard-delete others; cannot edit others' prompts/settings.
- Viewer/public can only read public agents and competition.

Ownership checks:

- API resolves caller identity from auth context.
- Mutating routes enforce `owner_user_id == current_user || role == admin`.

## API Plan

### Read APIs

- `GET /api/agents` - list by visibility/role
- `GET /api/agents/:id` - full profile
- `GET /api/agents/:id/prompt`
- `GET /api/agents/:id/memory`

### Mutating APIs

- `POST /api/agents` - create agent folder + profile/prompt/memory + registry append
- `PATCH /api/agents/:id` - update profile fields
- `POST /api/agents/:id/prompt` - update prompt layers
- `POST /api/agents/:id/avatar` - upload/replace local avatar
- `POST /api/agents/:id/runtime` - start/stop/show_in_competition toggles
- `DELETE /api/agents/:id` - user archive / admin hard delete

### Safety and validation

- JSON schema validation per payload
- Path sanitization (no `..`, no absolute paths)
- Avatar extension whitelist (`.png`, `.jpg`, `.jpeg`, `.webp`, `.svg`)
- Size limits on uploads

## Runtime Integration

Replace static `TRADERS` bootstrap with registry loader:

1. On boot, load `registry.json` and active `profile.json` files.
2. Build runtime `traders[]` from active profiles.
3. Map `trader_id -> agent_id` for prompt/avatar/memory lookup.
4. LLM decision path reads layered prompt from `prompt.json`.
5. Memory writes target `data/agents/<agent_id>/memory.json` (compat adapter for current store).
6. Competition endpoint derives participants from `show_in_competition=true`.

Reload policy:

- Initial phase: explicit refresh endpoint `POST /api/dev/reload-agents`.
- Later: fs watcher with debounce.

## UI Plan

Admin UI (AI Traders page):

- Add agent list from `/api/agents`.
- Add create modal (name/model/style/avatar).
- Add edit modal for profile + prompt.
- Add remove/archive controls by role.

User UI:

- "My Agents" scope default; can create and edit owned agents.
- Can choose public/private visibility if allowed.

Room/Competition UI:

- Use avatar path from agent profile.
- Keep fallback to generated punk avatar.

## Migration Plan

Phase 0 (one-time scaffold):

1. Create `data/agents/registry.json` from current hardcoded trader set.
2. Create `a_001..a_00N` folders with `profile.json`, `prompt.json`, `memory.json`.
3. Copy or reference current local avatar assets for matching trader IDs.

Phase 1 (read switch):

1. Backend reads registry-based traders for list/status/competition.
2. Keep old constants as fallback guard with warning logs.

Phase 2 (write switch):

1. Enable create/edit/delete APIs writing to registry/folders.
2. Enable prompt save from webpage.

Phase 3 (cleanup):

1. Remove hardcoded trader constants.
2. Remove temporary compatibility adapters.

## Consistency + Reliability

Write strategy:

- Use atomic write helper (`*.tmp` then rename) for JSON files.
- Use append-only JSONL for journals/decision logs.
- Lock registry writes with process-local mutex.

Recovery:

- Keep `registry.json.bak` on each successful write.
- On parse error, auto-recover from backup and emit alert log.

## Testing Plan

Unit tests:

- Registry load/validate/save
- Ownership checks
- Prompt merge logic (universal + style + custom)
- Avatar upload validation
- Atomic write behavior

Integration tests:

- Create agent -> appears in `/api/traders` and UI
- Update prompt -> next decision cycle uses new prompt
- Delete/archive agent -> hidden from competition where expected
- Factory reset keeps registry/profiles but resets runtime + memory

Manual QA:

- Admin creates 2 agents (punk + photo), user creates 1 agent
- User cannot edit admin-owned agent
- Restart server; all agents persist and reload correctly

## Deployment Steps

1. Deploy code to VM (`git push`, VM `git pull --ff-only`).
2. Backup existing `data/agent-memory` and generated assets.
3. Run migration script to seed `data/agents`.
4. Restart `runtime-api`; verify `GET /api/agents`.
5. Validate UI create/edit/delete/prompt save.

## Acceptance Criteria

- No hardcoded trader roster required for normal operation.
- Admin/user permissions enforced on all mutating routes.
- Webpage can save prompt updates and runtime uses them.
- Agent avatar/profile/prompt/memory persist across restarts.
- Competition shows agents from registry config.
