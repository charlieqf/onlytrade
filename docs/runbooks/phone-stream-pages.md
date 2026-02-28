# Phone Stream Pages Reference

This document tracks the 4 formal phone-first stream pages, their routes, and the runtime data contract.

## Pages and Routes

- Command Deck New (concise, user-first)
  - Route: `/stream/command-deck-new?trader=<trader_id>`
  - File: `onlytrade-web/src/pages/design/CommandDeckNewPage.tsx`
  - Notes:
    - Removes runtime transport/freshness badges from UI
    - Uses top thin support/against bar (viewer sentiment mock)
    - Defaults page copy to Chinese

- Command Deck
  - Route: `/stream/command-deck?trader=<trader_id>`
  - Legacy alias: `/design/expert-1?trader=<trader_id>`
  - File: `onlytrade-web/src/pages/design/Expert1CommandDeckPage.tsx`

- Mobile Broadcast
  - Route: `/stream/mobile-broadcast?trader=<trader_id>`
  - Legacy alias: `/design/expert-2?trader=<trader_id>`
  - File: `onlytrade-web/src/pages/design/Expert2MobileBroadcastPage.tsx`

- Studio Timeline
  - Route: `/stream/studio-timeline?trader=<trader_id>`
  - 8000 bridge route: `/onlytrade/stream/studio-timeline?trader=<trader_id>`
  - Legacy alias: `/design/expert-3?trader=<trader_id>`
  - File: `onlytrade-web/src/pages/design/Expert3StudioTimelinePage.tsx`

- Story Broadcast (blog/说书/口播)
  - Route: `/stream/story-broadcast?trader=<trader_id>`
  - 8000 bridge route: `/onlytrade/stream/story-broadcast?trader=<trader_id>`
  - Legacy alias: `/design/story-broadcast?trader=<trader_id>`
  - File: `onlytrade-web/src/pages/design/StoryOralBroadcastPage.tsx`
  - Asset root: `onlytrade-web/public/story/<story_slug>/`
  - Built-in trader mapping:
    - `t_007` -> `zhaolaoge`
    - `t_008` -> `xuxiang`
    - `t_009` -> `qingshan`
    - `t_010` -> `ai_daily_20260226`
    - `t_011` -> `citrini_ghost_20260226`
    - `t_012` -> `ai_tribunal_20260226`
    - `t_013` -> `mandela_effect`
    - `t_014` -> `libai`
  - Optional override: `?story=<story_slug>`

Path-based bridge notes:

- Preferred public entry is `http://<host>:8000/onlytrade/...`.
- SSE and API calls must resolve under `/onlytrade/api/...` when on `/onlytrade` pages.
- Story assets are served from `/onlytrade/story/<story_slug>/...` on bridged routes.

All four pages use shared stream logic in `onlytrade-web/src/pages/design/phoneStreamShared.tsx`.

## Common Data Contract

- Source of truth is room stream packet (`room.stream_packet.v1`) from:
  - `GET /api/rooms/:roomId/stream-packet`
  - `GET /api/rooms/:roomId/events` (SSE)
- Decisions:
  - Primary: `streamPacket.decisions_latest`
  - Fallback: `streamPacket.decision_audit_preview.records`
- Chat:
  - `GET /api/rooms/:roomId/chat/public`
- UI is read-only for these 4 pages.
- Symbol focus priority:
  - latest decision symbol -> thinking symbol -> largest position symbol

## Chart Window Policy (Phone)

- The three expert pages use daily bars with a one-month window:
  - `interval=1d`
  - `limit=30`
- Implementation: `onlytrade-web/src/components/PhoneRealtimeKlineChart.tsx`

## Red/Blue (Market Breadth)

### Live File Pipeline

- Canonical file: `data/live/onlytrade/market_breadth.cn-a.json`
- Builder scripts:
  - `scripts/akshare/run_red_blue_cycle.py`
  - `scripts/akshare/run_red_blue_if_market_open.py`
- Ops commands:
  - `bash scripts/onlytrade-ops.sh red-blue-cn-run-once`
  - `bash scripts/onlytrade-ops.sh red-blue-cn-if-open`

### Replay Pipeline

- Replay breadth file path (latest pack):
  - `onlytrade-web/public/replay/cn-a/latest/market_breadth.1m.json`
- Builder:
  - `scripts/replay/build_market_breadth_replay.py`
- Ops command:
  - `bash scripts/onlytrade-ops.sh red-blue-replay-build`
  - with day filter: `--day-key YYYY-MM-DD`

### Runtime API Exposure

- Stream packet fields:
  - `streamPacket.market_breadth`
  - `streamPacket.room_context.market_breadth`
  - `streamPacket.room_context.market_breadth_summary`
- Runtime status file diagnostics:
  - `market_breadth_files` under `/api/agent/runtime/status`

## UX Constraints Applied

- Phone-only layouts for all 4 formal pages.
- Avatar slot fixed to bottom-left area, resizable, with digital human visual slot + live TTS playback.
- Public chat is display-only.
- Betting and gifting are not present in these 4 pages.

### Story Broadcast UI Policy

- Top transport/status badges are hidden (no SSE/connected/freshness chips in page header).
- Bottom control row is simplified:
  - keeps narration `Pause/Resume` and progress scrubber
  - removes `Narration loop` badge
  - removes `BGM on/off` toggle and BGM volume slider
- For single-scene stories, background image uses `object-contain` to avoid aggressive crop under top panel.

### Story Speaker Cues

- If `script.txt` lines are speaker-tagged (for example `[alpha]`, `[xiaozhen]`, `[listener]`):
  - host/guest badges show `在发言` when active subtitle role matches
  - listener segments add subtle phone-line noise overlay while narration plays
- Untagged scripts still play normally, but speaker badges/noise effects will not activate.

## Voice / TTS Behavior

- All stream pages now support room TTS playback:
  - `/stream`
  - `/stream-only`
  - `/stream/command-deck`
  - `/stream/mobile-broadcast`
  - `/stream/studio-timeline`
  - `/stream/story-broadcast`
- Default state is voice autoplay ON in page UI (browser autoplay policy can still require first user click).
- Voice playback includes agent message kinds:
  - `reply`
  - `proactive`
  - `narration`
- Runtime API endpoints used by frontend:
  - `GET /api/chat/tts/config`
  - `POST /api/chat/tts` with body `{ "room_id": "<trader_id>", "text": "..." }`

### Provider routing (room-level)

- Room TTS provider can be switched without UI controls using ops CLI only.
- Supported providers:
  - `openai`
  - `selfhosted` (`http://101.227.82.130:13002/tts`, default media type `wav`)
- Persisted profile endpoint set:
  - `GET /api/chat/tts/profile?room_id=<trader_id>`
  - `POST /api/chat/tts/profile` (token-protected)
  - `DELETE /api/chat/tts/profile?room_id=<trader_id>` (token-protected)
- Runtime response headers for observability:
  - `x-tts-provider`
  - `x-tts-voice`
  - `x-tts-speed`
  - `x-tts-model`

### Hosted TTS validation baseline (2026-02-26)

- Endpoint: `http://101.227.82.130:13002/tts`
- Payload mode: `streaming_mode=true`, voice `xuanyijiangjie`
- Format results:
  - `media_type=wav` -> `HTTP 200`, `audio/wav`, first-byte ~`1.30s`, non-empty stream
  - `media_type=raw` -> `HTTP 200`, `audio/raw`, first-byte ~`1.47s`, non-empty stream
  - `media_type=mp3` -> `HTTP 400` (unsupported in current backend)
- Runtime default for self-hosted path is `wav`.
- Known good room voice id for self-hosted routing: `xuanyijiangjie` (override per room with `tts-set --voice`).

### Ops commands (local / SSH wrapper)

```bash
bash scripts/onlytrade-ops.sh tts-status t_003
bash scripts/onlytrade-ops.sh tts-set t_003 --provider selfhosted --voice xuanyijiangjie --fallback openai
bash scripts/onlytrade-ops.sh tts-test t_003 --text "语音连通测试"
bash scripts/onlytrade-ops.sh tts-clear t_003

bash scripts/onlytrade-ssh-ops.sh tts-status t_003
bash scripts/onlytrade-ssh-ops.sh tts-set t_003 --provider selfhosted --voice xuanyijiangjie --fallback openai
bash scripts/onlytrade-ssh-ops.sh tts-test t_003
```

## WeCom Browser Notes

- WeCom webview can block autoplay until first interaction.
  - Keep defaults ON for voice/BGM, but expect one user tap to unlock media.
- If voice is silent, test backend directly:

```bash
curl -fsS -X POST "http://127.0.0.1:18080/api/chat/tts" \
  -H "Content-Type: application/json" \
  -d '{"room_id":"t_003","text":"语音测试"}'
```

- If this fails with `openai_tts_http_429`, backend TTS quota is exhausted.
- For stale bundles in WeCom, use cache-busting query params (for example `&v=20260224a`).

## Stream Health Banner Semantics

- `Degraded stream` indicates transport or packet freshness fallback.
- In bridged `/onlytrade` pages, false positives can occur if URL base/path handling is wrong.
- First check these endpoints:

```bash
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" \
  "http://<host>:8000/onlytrade/api/rooms/t_003/events?decision_limit=5"
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" \
  "http://<host>:8000/onlytrade/api/rooms/t_003/stream-packet?decision_limit=5"
```

Operator command alternative (without exposing status badges in UI):

```bash
bash scripts/onlytrade-ops.sh stream-monitor t_003
```

## Viewer Simulator (Ops)

Use backend ops command to simulate many random viewers (stock talk + casual chat):

```bash
bash scripts/onlytrade-ops.sh viewer-sim t_003 --viewers 24 --busy high --duration-min 15
```

Use steady cadence (default) for roughly constant viewer message tempo:

```bash
bash scripts/onlytrade-ops.sh viewer-sim t_003 --viewers 24 --busy normal --tempo steady --duration-min 30
```

Optional LLM content mode (fallback to template if unavailable in mixed mode):

```bash
bash scripts/onlytrade-ops.sh viewer-sim t_003 --viewers 24 --busy normal --duration-min 10 --content mixed --llm-ratio 0.4
```

Busy presets:

- `low`: slower chat cadence
- `normal`: default cadence
- `high`: dense chat cadence
