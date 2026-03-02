# t_015 Realtime Commentary + TTS Sync Plan

## Goal

For `http://zhibo.quickdealservice.com:18000/onlytrade/stream/polymarket?trader=t_015`:

- use `qwen3-max` to generate event/news commentary,
- speak commentary with realtime TTS,
- support multiple commentator personas (style + voice),
- keep spoken commentary nearly in sync with on-screen market/log changes.

## Reality Constraints

1. Current `CyberPredictionPage` renders from `cyber_market_live.json` polling and has no dedicated commentary audio lane.
2. Current `/api/chat/tts` is room-profile driven and convenient for single room voice, but not ideal for multi-commentator voice switching per utterance.
3. Cosy realtime path currently has multi-second latency and is not suitable for strict live sync.

## Proposed Architecture

### 1) Event Trigger Layer (server side)

Detect commentary-worthy events from polymarket state:

- market switch,
- probability jump crossing threshold,
- large AI trade,
- volume spike,
- hot-topic/news change.

Emit a normalized event object:

- `event_id`, `event_type`, `event_ts_ms`,
- `market_snapshot` (title, yes/no prob, delta),
- `related_logs` (compact).

### 2) Qwen Commentary Generator

For each event, call `qwen3-max` with strict JSON output:

- `speaker_id`,
- `style_id`,
- `text` (short, broadcast-safe),
- `priority`,
- `target_play_ts_ms`.

Hard requirements in prompt:

- reference concrete numbers/events visible on page,
- one clear angle per line,
- no hallucinated facts,
- cap length for TTS speed.

### 3) Multi-Commentator Profile

Introduce room-level commentator config (example path):

- `agents/t_015/commentators.json`

Each speaker:

- `speaker_id`
- `display_name`
- `style_prompt_cn`
- `voice_id` (selfhosted)
- `cooldown_ms`
- `enabled`

### 4) TTS Lane

Generate audio per commentary item and attach:

- `audio_url` (or blob endpoint id),
- `voice_id`,
- `audio_duration_ms`,
- `target_play_ts_ms`.

Primary mode: selfhosted low-latency voices.
Fallback: text-only commentary if TTS generation fails.

### 5) Frontend Sync Lane

Extend payload consumed by `CyberPredictionPage` to include `commentary[]`.

Client behavior:

- render commentary row tied to event/log,
- queue audio by `target_play_ts_ms`,
- small jitter buffer,
- drop stale items,
- avoid overlap (single channel with optional interruption policy).

## Hot-Switch Voice Design

Yes, voice hot-switch can be convenient.

### A) Immediate (already available)

Room-level hot switch via existing ops script:

```bash
bash scripts/onlytrade-ops.sh tts-set t_015 --provider selfhosted --voice zsy --fallback none
bash scripts/onlytrade-ops.sh tts-set t_015 --provider selfhosted --voice xuanyijiangjie --fallback none
```

### B) Planned for multi-commentator

Add speaker-level hot switch without restart:

- endpoint: `POST /api/polymarket/commentary/profile`
- payload example:

```json
{
  "room_id": "t_015",
  "speaker_id": "host_a",
  "voice_id": "zsy"
}
```

This updates only that speaker voice and applies to new commentary immediately.

## Latency Targets

- Event detect: <= 100 ms
- LLM generate: <= 1200 ms p95
- TTS generate (selfhosted): <= 1200 ms p95
- Audio start after ready: <= 300 ms
- End-to-end event -> audio start: <= 2.8 s p95

## Rollout Steps

1. Add commentary schema and event trigger service behind feature flag.
2. Add speaker profile store + hot-switch API.
3. Add frontend commentary/audio queue lane.
4. Enable on `t_015` only and observe latency/failure metrics.
5. Tune thresholds/cooldowns and extend to other rooms.

## Verification Checklist

- `commentary[]` updates with event-aligned text.
- Spoken line references on-screen market numbers correctly.
- No audio overlap burst under high event frequency.
- Speaker voice switch works live without process restart.
- Fallback works: text still appears when TTS fails.
