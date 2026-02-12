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
  "visibility": "public|private",
  "message_type": "public_plain|public_mention_agent|private_agent_dm",
  "text": "...",
  "created_ts_ms": 1739333000123
}
```

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
