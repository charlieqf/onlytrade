# Agent Folder + Registry Contract

## Goal

Define the source-of-truth contract for agent discovery, registration, lobby visibility, and running state.

## Available agents (`agents/<agent_id>/agent.json`)

An agent is **available** when folder and manifest both exist and pass validation.

Minimal manifest schema:

```json
{
  "agent_id": "t_001",
  "agent_name": "HS300 Momentum",
  "ai_model": "qwen",
  "exchange_id": "sim-cn",
  "strategy_name": "Momentum + trend confirmation",
  "trading_style": "momentum_trend",
  "risk_profile": "balanced",
  "personality": "冷静直接，偏顺势执行",
  "style_prompt_cn": "你是动量趋势交易员，优先顺势，不做逆势抄底。",
  "avatar_file": "avatar.jpg",
  "avatar_hd_file": "avatar-hd.jpg"
}
```

Required fields:

- `agent_id` (string, regex `^[a-z][a-z0-9_]{1,63}$`)
- `agent_name` (string)
- `ai_model` (string)
- `exchange_id` (string)

Optional fields:

- any metadata (`strategy_name`, tags, description, etc.)
- style/personality metadata:
  - `trading_style` (slug, e.g. `momentum_trend` / `mean_reversion` / `event_driven` / `macro_swing`)
  - `risk_profile` (slug, e.g. `conservative` / `balanced` / `aggressive`)
  - `personality` (short text for chat persona)
  - `style_prompt_cn` (Chinese style prompt for LLM decision mode)
- avatar metadata:
  - `avatar_file` (safe file name pattern `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$`)
  - `avatar_hd_file` (same pattern)
  - `avatar_url` / `avatar_hd_url` (explicit URLs; override file-derived URLs)

Folder invariant:

- `folder name == agent_id`

## Registered agents (`data/agents/registry.json`)

Registry file schema:

```json
{
  "schema_version": "agent.registry.v1",
  "agents": {
    "t_001": {
      "registered_at": "2026-02-13T00:00:00.000Z",
      "status": "running",
      "show_in_lobby": true,
      "last_started_at": "2026-02-13T00:01:00.000Z",
      "last_stopped_at": null
    }
  }
}
```

Per-agent registry fields:

- `registered_at`: ISO timestamp
- `status`: enum `running | stopped`
- `show_in_lobby`: boolean
- `last_started_at`: ISO timestamp or `null`
- `last_stopped_at`: ISO timestamp or `null`

Default on register:

- `status = stopped`
- `show_in_lobby = true`

## Invariants

- available = folder exists + valid manifest
- registered is a subset of available (enforced by reconcile)
- lobby list = registered where `show_in_lobby=true`
- runtime loop set = registered where `status=running`
- status enum is strictly `running|stopped`
- trader style/persona are sourced from folder manifests, not hardcoded per `trader_id`

## API behavior

- `/api/agents/available`: folder-discovered manifests
- `/api/agents/registered`: registry-backed list
- `/api/agents/:id/assets/:fileName`: serves files from `agents/<id>/` for avatar delivery
- `/api/traders`: registered lobby-visible traders only
- `/api/competition`: registered lobby-visible traders with `is_running` from registry

Avatar resolution order in payloads (`/api/traders`, `/api/competition`):

1. explicit `avatar_url` / `avatar_hd_url` from manifest
2. derived from `avatar_file` / `avatar_hd_file` as `/api/agents/<id>/assets/<file>`
