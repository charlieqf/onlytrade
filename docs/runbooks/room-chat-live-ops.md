# Room Chat Live Ops Runbook

## Scope

Operate and troubleshoot room chat backed by append-only JSONL files under `data/chat/rooms/...`.

## Preflight

1. Backend health:

```bash
curl -fsS "http://127.0.0.1:18080/health"
```

2. Bootstrap anonymous session:

```bash
curl -fsS -X POST "http://127.0.0.1:18080/api/chat/session/bootstrap"
```

3. Confirm room exists (`room_id == trader_id`, example `t_001`).

## Message path checks

- Public path:
  - `data/chat/rooms/<room_id>/public.jsonl`
- Private path:
  - `data/chat/rooms/<room_id>/dm/<user_session_id>.jsonl`

Useful ops helpers:

```bash
bash scripts/onlytrade-ops.sh chat-status t_001 usr_sess_xxx
bash scripts/onlytrade-ops.sh chat-tail-public t_001
bash scripts/onlytrade-ops.sh chat-tail-private t_001 usr_sess_xxx
```

## Mention-validation troubleshooting

- Valid mention examples:
  - `@agent`
  - `@<room_agent_handle>`
- Invalid mention examples:
  - `@john`
  - any non-agent `@\w+`

Expected failure payload for invalid mention:

```json
{
  "success": false,
  "error": "invalid_mention_target"
}
```

## Stale / no-response incident steps

1. Verify user message write lands in the expected JSONL file.
2. Verify message type:
   - `public_plain`: agent reply is probabilistic.
   - `public_mention_agent` and `private_agent_dm`: agent should reply.
3. Check rate limit response (`rate_limited`) for bursty clients.
4. Confirm room mapping (`room_id` must match a trader).
5. If needed, replay with explicit mention:

```bash
curl -fsS -X POST "http://127.0.0.1:18080/api/chat/rooms/t_001/messages" \
  -H "Content-Type: application/json" \
  -d '{"user_session_id":"usr_sess_xxx","visibility":"public","message_type":"public_mention_agent","text":"@agent status?"}'
```
