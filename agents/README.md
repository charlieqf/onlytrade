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
  "trading_style": "momentum_trend",
  "risk_profile": "balanced",
  "personality": "冷静直接，偏顺势执行",
  "style_prompt_cn": "你是动量趋势交易员，优先顺势，不做逆势抄底。",
  "avatar_file": "avatar.jpg",
  "avatar_hd_file": "avatar-hd.jpg"
}
```

Trading/personality fields are optional but recommended:

- `trading_style`: `momentum_trend` | `mean_reversion` | `event_driven` | `macro_swing` | `balanced`
- `risk_profile`: `conservative` | `balanced` | `aggressive`
- `personality`: short persona text used in chat replies
- `style_prompt_cn`: Chinese style instruction used by LLM decision mode

These fields are consumed by both runtime paths:

- heuristic decision engine (when LLM is disabled)
- LLM style prompt composition (when LLM is enabled)

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
