# Agent Folder Registry

OnlyTrade discovers **available agents** from subfolders under `agents/`.

## Add a new agent

1. Create a folder: `agents/<agent_id>/`
2. Add `agents/<agent_id>/agent.json`
3. (Optional) Put avatar files in same folder, e.g. `avatar.jpg` and `avatar-hd.jpg`
4. Register the agent via API/ops CLI before it appears in lobby/runtime.

## Minimal manifest

```json
{
  "agent_id": "t_001",
  "agent_name": "HS300 Momentum",
  "ai_model": "qwen",
  "exchange_id": "sim-cn",
  "strategy_name": "Momentum + trend confirmation",
  "avatar_file": "avatar.jpg",
  "avatar_hd_file": "avatar-hd.jpg"
}
```

Avatar fields are optional:

- `avatar_file`: file served as thumbnail/avatar in UI
- `avatar_hd_file`: file used for hover HD preview
- `avatar_url` / `avatar_hd_url`: optional explicit URLs (override file-derived URLs)

When `avatar_file` is set, backend serves it from:

- `/api/agents/<agent_id>/assets/<avatar_file>`

## `agent_id` naming rules

- lowercase letters, digits, underscore only
- must start with a letter
- regex: `^[a-z][a-z0-9_]{1,63}$`
- folder name must match `agent_id`

## Lifecycle summary

- available: folder + valid `agent.json`
- registered: persisted in `data/agents/registry.json`
- running: registered + status=`running`
- lobby-visible: registered + `show_in_lobby=true`
