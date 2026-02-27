# Room-Level TTS Provider Switch Plan (Persistent by Default)

Goal: allow each agent/stream room to switch between OpenAI voices and Shanghai self-hosted voices via ops scripts (no UI control), with room overrides persisted by default.

## Scope

1. Validate Shanghai self-hosted TTS service compatibility and latency.
2. Add runtime provider routing (OpenAI vs selfhosted) per room.
3. Add persistent room TTS profile storage.
4. Add protected backend endpoints for check/switch operations.
5. Add ops commands (`onlytrade-ops.sh` + SSH wrapper passthrough).
6. Add tests and runbook updates.

## Step 1 (First) - Hosted TTS Validation

This is the first execution step before coding provider switching.

### Validation checklist

- Endpoint reachability from host(s): `http://101.227.82.130:13002/tts`.
- Supported output formats for browser playback:
  - `media_type=wav` (required)
  - `media_type=raw` (fallback only)
  - `media_type=mp3` (optional)
- Streaming behavior (`streaming_mode=true`) and first-byte latency.
- Voice id usability for target rooms (e.g. `xuanyijiangjie`, others from voice list).
- Error behavior (HTTP code + error body) for bad payloads.

### Current baseline (already observed)

- `wav` returns `200` with `audio/wav` and valid RIFF bytes.
- `raw` returns `200` with `audio/raw`.
- `mp3` currently returns `400`.
- First-byte latency around ~1.4s on test call.

### Acceptance for Step 1

- Confirm `wav` is stable and selected as self-hosted default output.
- Confirm service is reachable from runtime environment (VM) with acceptable latency.
- Record at least one known-good `voice_id` for each room that will use self-hosted TTS.

## Workstream A - Runtime Provider Abstraction

### Changes

- In `runtime-api/server.mjs`, split synthesis into provider functions:
  - `synthesizeOpenAITts(...)` (existing)
  - `synthesizeSelfHostedTts(...)` (new)
- Add provider dispatcher for each `/api/chat/tts` request:
  - resolve room profile
  - call selected provider
  - return unified audio response
- Add response headers for observability:
  - `x-tts-provider`, `x-tts-voice`, `x-tts-speed`, `x-tts-model`.

### Env additions

- `CHAT_TTS_PROVIDER_DEFAULT=openai`
- `CHAT_TTS_SELFHOSTED_URL=http://101.227.82.130:13002/tts`
- `CHAT_TTS_SELFHOSTED_TIMEOUT_MS=8000`
- `CHAT_TTS_SELFHOSTED_MEDIA_TYPE=wav`
- Optional room defaults:
  - `CHAT_TTS_SELFHOSTED_VOICE_<TRADER_ID>=<voice_id>`

### Acceptance

- `/api/chat/tts` works for both providers and returns browser-playable audio.
- Provider used is visible in response headers and runtime status.

## Workstream B - Persistent Room TTS Profiles (Default Persistent)

### Changes

- Add persisted profile store under runtime data (atomic write pattern):
  - `runtime-api/data/chat/tts_profiles.json`
- Profile model:
  - global default provider
  - per-room override: `provider`, `voice`, `speed`, `fallback_provider`.
- Persistence policy:
  - room override writes are persistent by default.

### Acceptance

- Room profile changes survive runtime restart.
- Clearing profile returns room to computed default.

## Workstream C - Backend Control Endpoints (Token-Protected)

### Changes

- Add endpoints in `runtime-api/server.mjs` protected via `requireControlAuthorization(...)`:
  - `GET /api/chat/tts/profile?room_id=<id>`
  - `POST /api/chat/tts/profile` (set/switch room profile; persists)
  - `DELETE /api/chat/tts/profile?room_id=<id>` (clear room override)
- Extend `GET /api/chat/tts/config` to include provider capability + effective room mappings.

### Acceptance

- Mutating profile endpoints require control token when configured.
- Read endpoint returns effective profile for ops diagnostics.

## Workstream D - Ops CLI (No UI Control)

### `scripts/onlytrade-ops.sh`

- Add commands:
  - `tts-status [room_id]`
  - `tts-set <room_id> --provider openai|selfhosted --voice <id> [--speed N] [--fallback openai|none]`
  - `tts-clear <room_id>`
  - `tts-test <room_id> [--text "..."]`
- `tts-set` persists by default.

### `scripts/onlytrade-ssh-ops.sh`

- No protocol change needed; wrapper passes commands through.
- Update help examples for remote room switching.

### Acceptance

- Operators can check/switch/clear room voice routing from CLI only.
- `tts-test` confirms provider, voice, latency, and payload size.

## Workstream E - Tests

### Changes

- Extend `runtime-api/test/chatTtsRoutes.test.mjs`:
  - profile set/get/clear flow
  - token enforcement on mutating endpoints
  - dispatch behavior for openai vs selfhosted (mock upstream)
- Keep existing OpenAI validation tests passing.

### Acceptance

- Test suite passes with no regression in existing `/api/chat/tts` behavior.

## Rollout Plan

1. Complete Step 1 hosted TTS validation and lock output to `wav`.
2. Implement provider dispatcher + profile store + endpoints.
3. Implement ops commands and SSH help updates.
4. Deploy runtime API.
5. Run smoke checks:
   - `tts-status t_003`
   - `tts-set t_003 --provider selfhosted --voice xuanyijiangjie`
   - `tts-test t_003`
   - `tts-set t_003 --provider openai --voice nova`
6. Update runbooks.

## File-Level Map

- `runtime-api/server.mjs`
- `runtime-api/test/chatTtsRoutes.test.mjs`
- `runtime-api/README.md`
- `scripts/onlytrade-ops.sh`
- `scripts/onlytrade-ssh-ops.sh`
- `docs/runbooks/phone-stream-pages.md`
