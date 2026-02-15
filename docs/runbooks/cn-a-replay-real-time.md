# CN-A Replay at Real Speed (Room/Agent Soak Test)

Goal: use the bundled 3-day CN-A replay dataset to simulate a live feed at real-time speed so you can observe:

- Agent decision cadence (e.g. every 1 minute)
- Public proactive chat cadence (e.g. every 15-20s)
- Agent replies to @mentions / DMs

This runbook uses `runtime-api` replay mode.

## Prereqs

- `runtime-api` and `onlytrade-web` running locally
- Replay dataset exists:
  - `onlytrade-web/public/replay/cn-a/latest/frames.1m.json`

## Configure runtime-api

Edit `runtime-api/.env.local` and set:

```env
# Run from historical frames as a simulated live feed.
RUNTIME_DATA_MODE=replay

# Strict live expects live files; disable for replay.
STRICT_LIVE_MODE=false

# Real-time: 1 bar (1m) per real minute.
REPLAY_SPEED=1
REPLAY_LOOP=true

# Real scenario: agent decision every 1m.
AGENT_DECISION_EVERY_BARS=1

# Public proactive cadence (15-20s band).
CHAT_PUBLIC_PROACTIVE_INTERVAL_MS=18000
```

Restart `runtime-api` after editing `.env.local` (env is loaded at boot).

## Start the 3-day replay run

From repo root:

```bash
bash scripts/onlytrade-ops.sh start-3day --speed 1 --cadence 1 --warmup
```

Notes:

- `--speed 1` means replay advances 1 x 1-minute bar per real minute.
- `--cadence 1` means agents step every bar.
- `--warmup` starts the replay cursor after the warmup window so indicators have history.

## Observe expected behavior

### Verify replay speed + cursor advancing

```bash
bash scripts/onlytrade-ops.sh status
```

You should see replay status with `speed=1` and `cursor_index` increasing over time.

### Watch continuously

```bash
bash scripts/onlytrade-ops.sh watch 3
```

### Check room public chat cadence

Open a room page in the web UI so the room SSE stream is connected.
Proactive public messages are viewer-gated: they tick when at least one SSE client is connected for that room.

Optional tuning (runtime-api env):

```env
# Viewer-gated proactive tick (server-side).
CHAT_PROACTIVE_VIEWER_TICK_ENABLED=true
CHAT_PROACTIVE_VIEWER_TICK_MS=2000
CHAT_PROACTIVE_VIEWER_TICK_ROOMS_PER_INTERVAL=2
CHAT_PROACTIVE_VIEWER_TICK_MIN_ROOM_INTERVAL_MS=5000
```

Tail the room public chat file:

```bash
bash scripts/onlytrade-ops.sh chat-tail-public t_001
```

With `CHAT_PUBLIC_PROACTIVE_INTERVAL_MS=18000`, you should see an agent proactive line roughly every ~18 seconds when the room is quiet (and the room SSE stream stays connected).

### Mention reply behavior

In the room public chat input, send a message that mentions the agent:

- `@agent 汇报一下`

Expected: the agent replies immediately (subject to LLM latency).

If LLM is disabled or timing out, mention replies may fallback to a short canned reply depending on the runtime build.

## Common adjustments

- Faster soak tests (not real-time): increase replay speed
  - `bash scripts/onlytrade-ops.sh set-speed 5`
- Reduce randomness of non-mention public replies:
  - set `CHAT_PUBLIC_PLAIN_REPLY_RATE=0` in `runtime-api/.env.local` and restart
- Tune room stream packet refresh interval (UI dashboard updates):
  - `ROOM_EVENTS_STREAM_PACKET_INTERVAL_MS=15000` (default)
