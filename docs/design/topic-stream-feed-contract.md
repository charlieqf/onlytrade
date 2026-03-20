# Topic Stream Feed Contract

This document is the canonical runtime contract for topic-commentary programs that reuse the `t_017` local-generation pattern.

Current target programs:

- `t_018` / `five-league`
- `t_019` / `china-bigtech`

## Design intent

- one generic player page
- one generic live-feed endpoint
- one room-scoped image/audio asset model
- program differences handled by config and theme, not by separate frontend/backend stacks

## Top-level payload

```json
{
  "schema_version": "topic.stream.feed.v1",
  "room_id": "t_018",
  "program_slug": "five-league",
  "program_title": "五大联赛每日评书",
  "program_style": "storytelling_sharp",
  "as_of": "2026-03-08T10:00:00Z",
  "topic_count": 10,
  "topics": []
}
```

Required top-level fields:

- `schema_version`
- `room_id`
- `program_slug`
- `program_title`
- `as_of`
- `topic_count`
- `topics`

Optional top-level fields:

- `program_style`
- `generation_stats`
- `titles`
- `background_notes`

## Topic row

```json
{
  "id": "five_league_real_madrid_20260308_01",
  "entity_key": "real_madrid",
  "entity_label": "Real Madrid",
  "category": "football",
  "title": "Mbappe saves Madrid late again",
  "screen_title": "皇马这场又赢得不体面，但赢得很豪门",
  "summary_facts": "皇马补时阶段再次绝杀，继续维持争冠压力。",
  "commentary_script": "今天这场球，皇马赢得很像皇马......",
  "screen_tags": ["Late winner", "Title race", "Defensive wobble"],
  "source": "BBC Sport",
  "source_url": "https://example.com/story",
  "published_at": "2026-03-08T09:20:00Z",
  "image_file": "madrid_20260308_01.jpg",
  "audio_file": "five_league_real_madrid_20260308_01.mp3",
  "image_api_url": "/api/topic-stream/images/t_018/madrid_20260308_01.jpg",
  "audio_api_url": "/api/topic-stream/audio/t_018/five_league_real_madrid_20260308_01.mp3",
  "script_estimated_seconds": 74,
  "priority_score": 0.92,
  "topic_reason": "late winner + title-race attention"
}
```

Required topic fields:

- `id`
- `entity_key`
- `entity_label`
- `category`
- `title`
- `screen_title`
- `summary_facts`
- `commentary_script`
- `screen_tags`
- `source`
- `published_at`
- `image_file`
- `audio_file`

Optional topic fields:

- `source_url`
- `image_api_url`
- `audio_api_url`
- `script_estimated_seconds`
- `priority_score`
- `topic_reason`

## Field semantics

- `title`: stays close to the source headline; relatively neutral
- `screen_title`: host-facing poster title; shorter, sharper, more opinionated
- `summary_facts`: factual digest only; no sarcasm, no unsupported claims
- `commentary_script`: spoken script for the host persona; can be sharp, but must stay anchored to facts
- `screen_tags`: `3-5` short visual overlays; readable on mobile poster layout
- `topic_reason`: internal/explainer field for why the candidate survived ranking

## Release invariants

These are hard rules for `t_018` and `t_019` release feeds.

- every released topic must have a real `image_file`
- every released topic must have a pre-generated static `audio_file`
- every released topic must map to exactly one whitelisted entity
- one entity may appear at most once in a single released feed
- `topic_count` must equal the number of valid released topics
- weak or incomplete topics should be dropped, not padded

## Snapshot semantics

- The runtime contract shape stays the same for all rooms: one canonical JSON payload with one `topics` array.
- Canonical internal endpoints remain `/api/topic-stream/...`; public deployments may expose the same payload through the `/onlytrade/api/topic-stream/...` bridge without changing the payload contract.
- For direct-batch rooms, that payload may be a straight snapshot of the latest generation run.
- For `t_019` MVP, the payload is still a snapshot, but it is a retained rolling-buffer snapshot generated on the VM after merging the newest incoming batch into the existing canonical feed.
- The retained `t_019` MVP contract is: canonical file `data/live/onlytrade/topic_stream/china_bigtech_live.json`, dedupe key `topic.id`, keep-count `20`. See `docs/runbooks/topic-stream-ops.md` for the operator runbook.
- The retained `t_019` snapshot keeps the newest `20` valid topics after dedupe by `topic.id`; older retained topics may remain visible when the newest batch is smaller or weaker.
- This means a new `t_019` batch with only `1` valid topic should not collapse the live feed to `1` if older valid retained topics still exist.
- `topic_count`, `as_of`, and the `topics` array still describe the currently published canonical snapshot exposed by `/api/topic-stream/live`.

## Runtime endpoints

- `GET /api/topic-stream/live?room_id=<room_id>`
- `GET /api/topic-stream/images/:room_id/:file`
- `GET /api/topic-stream/audio/:room_id/:file`

Example:

- `GET /api/topic-stream/live?room_id=t_018`
- `GET /api/topic-stream/images/t_018/madrid_20260308_01.jpg`
- `GET /api/topic-stream/audio/t_018/five_league_real_madrid_20260308_01.mp3`

## Storage layout

```text
data/live/onlytrade/topic_stream/
  five_league_live.json
  china_bigtech_live.json

data/live/onlytrade/topic_images/
  t_018/
  t_019/

data/live/onlytrade/topic_audio/
  t_018/
  t_019/
```

## Playback assumptions

- player shows one topic at a time
- topic rotation happens only after current audio ends
- current and next audio may be preloaded
- new commentary pages should not depend on live TTS fallback in normal operation

## Program-specific notes

Football:

- `category` stays `football`
- commentary tone can be emotional, mocking, rivalry-driven
- `summary_facts` must still remain factual and concise

China big-tech:

- `category` may be `tech` or `vehicle`
- commentary can be sharp, but must clearly separate facts from framing
- rumors must be marked as unconfirmed in source material and in spoken treatment
