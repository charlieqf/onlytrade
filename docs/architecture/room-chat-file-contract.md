# Room Chat File Contract

## Goal

Define the backend contract for room-based chat with append-only file storage.

## One-room-one-agent invariant

- `room_id` maps directly to one trader/agent.
- Required invariant: `room_id == trader_id`.
- A room is valid only when exactly one agent identity is resolvable for that `room_id`.

## Message types

Allowed values for `message_type`:

- `public_plain`
- `public_mention_agent`
- `private_agent_dm`

Any other value must be rejected as `invalid_message_type`.

## Message schema

Each stored JSONL row is one message object:

```json
{
  "id": "msg_...",
  "room_id": "t_001",
  "user_session_id": "usr_sess_xxx",
  "sender_type": "user|agent",
  "sender_name": "TraderFox|HS300 Momentum",
  "visibility": "public|private",
  "message_type": "public_plain|public_mention_agent|private_agent_dm",
  "text": "...",
  "created_ts_ms": 1739333000123
}
```

## Session bootstrap

- `POST /api/chat/session/bootstrap`
- Returns both:
  - `user_session_id`
  - `user_nickname`

The frontend stores both values and includes `user_nickname` when posting messages.

## Agent talk cadence and context

- Public room has proactive agent check-ins when the room is quiet for configured interval.
- Default proactive interval: `CHAT_PUBLIC_PROACTIVE_INTERVAL_MS=90000`.
- Agent replies and proactive messages use today's same-day chat context (default timezone `Asia/Shanghai`).
- Context timezone is configurable via `CHAT_CONTEXT_TIMEZONE`.

## Storage paths

- Public timeline:
  - `data/chat/rooms/<room_id>/public.jsonl`
- Private user-agent timeline:
  - `data/chat/rooms/<room_id>/dm/<user_session_id>.jsonl`

Both files are append-only JSONL. One line equals one message.

## Mention validation rules

- Mention parsing token pattern: `@\w+`.
- Allowed mention targets are only:
  - `@agent`
  - `@<room_agent_handle>` (exact room agent handle)
- Any other mention token must be rejected with `invalid_mention_target`.
- User-to-user mentions are not allowed.
