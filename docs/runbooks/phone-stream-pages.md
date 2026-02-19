# Phone Stream Pages Reference

This document tracks the 3 formal phone-first stream pages, their routes, and the runtime data contract.

## Pages and Routes

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
  - Legacy alias: `/design/expert-3?trader=<trader_id>`
  - File: `onlytrade-web/src/pages/design/Expert3StudioTimelinePage.tsx`

All three pages use shared stream logic in `onlytrade-web/src/pages/design/phoneStreamShared.tsx`.

## Common Data Contract

- Source of truth is room stream packet (`room.stream_packet.v1`) from:
  - `GET /api/rooms/:roomId/stream-packet`
  - `GET /api/rooms/:roomId/events` (SSE)
- Decisions:
  - Primary: `streamPacket.decisions_latest`
  - Fallback: `streamPacket.decision_audit_preview.records`
- Chat:
  - `GET /api/rooms/:roomId/chat/public`
  - UI is read-only for these 3 pages.
- Symbol focus priority:
  - latest decision symbol -> thinking symbol -> largest position symbol

## Chart Window Policy (Phone)

- The three formal phone pages use daily bars with a one-month window:
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

- Phone-only layouts for all 3 formal pages.
- Avatar slot fixed to bottom-left area, resizable, with digital human/TTS placeholder.
- Public chat is display-only.
- Betting and gifting are not present in these 3 pages.
