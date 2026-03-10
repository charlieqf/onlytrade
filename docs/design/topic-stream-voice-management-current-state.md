# Topic Stream Voice Management Current State

Status: documented on 2026-03-10, no behavior change in this doc.

## Purpose

This note documents the current voice-management split across `t_017` to `t_020` and why it is considered design drift rather than an intentional product requirement.

The real product requirement is simple:

- each stream room needs its own voice
- pre-generated topic audio should be stable and repeatable
- changing a room voice should be easy to reason about

There is no known requirement-level difference between `t_017`, `t_018`, `t_019`, and `t_020` for how voice should be selected.

## Current reality

Two different voice-selection mechanisms are in use today.

### Mechanism A: room-managed voice via runtime API

The generator posts to `/onlytrade/api/chat/tts` and sends `room_id` plus text.

- runtime chooses voice from the room TTS profile
- fallback logic also lives in runtime
- generator does not need to know the final voice id in the normal path

Examples:

- `scripts/english/run_google_news_cycle.py`
- `scripts/topic_stream/run_five_league_cycle.py`
- `scripts/topic_stream/run_china_bigtech_cycle.py`

### Mechanism B: script-managed voice via direct selfhosted TTS

The generator posts directly to the selfhosted TTS endpoint and sends `voice_id` itself.

- voice selection lives in the local generator script
- runtime room profile is bypassed for the pre-generated asset
- fallback behavior depends on generator-side branching rather than one room-level source of truth

Examples:

- `scripts/topic_stream/run_china_bigtech_cycle.py`
- `scripts/topic_stream/run_five_league_cycle.py`

## Exact routing rule in code

For topic-stream generators, the routing choice is currently made by the configured `audio_tts_url`.

- if `audio_tts_url` ends with `/api/chat/tts`, use runtime API
- otherwise, call selfhosted TTS directly

Code references:

- `scripts/topic_stream/run_china_bigtech_cycle.py:797`
- `scripts/topic_stream/run_five_league_cycle.py:835`

So the current behavior is configuration-driven, not requirement-driven.

## Room-by-room current state

### `t_017` oral-english

- Local runner: `scripts/english/local_collect_and_push_t017.sh`
- Default TTS URL: `http://zhibo.quickdealservice.com:18000/onlytrade/api/chat/tts`
- Audio generation path: runtime API
- Voice owner in practice: room TTS profile in runtime

Relevant code:

- `scripts/english/run_google_news_cycle.py:36`
- `scripts/english/run_google_news_cycle.py:755`

### `t_018` five-league

- Local runner: `scripts/topic_stream/local_collect_and_push_t018.sh`
- Default TTS URL: `http://zhibo.quickdealservice.com:18000/onlytrade/api/chat/tts`
- Current default path: runtime API
- Alternate supported path: direct selfhosted if `audio_tts_url` is changed

Relevant code:

- `scripts/topic_stream/local_collect_and_push_t018.sh:34`
- `scripts/topic_stream/run_five_league_cycle.py:838`
- `scripts/topic_stream/run_five_league_cycle.py:848`

### `t_019` china-bigtech

- Local runner: `scripts/topic_stream/local_collect_and_push_t019.sh`
- Default TTS URL: `http://zhibo.quickdealservice.com:18000/onlytrade/api/chat/tts`
- Current default path: runtime API
- Alternate supported path: direct selfhosted if `audio_tts_url` is changed

Relevant code:

- `scripts/topic_stream/local_collect_and_push_t019.sh:33`
- `scripts/topic_stream/run_china_bigtech_cycle.py:799`
- `scripts/topic_stream/run_china_bigtech_cycle.py:808`

### `t_020` market-radar-lab

- Local runner: `scripts/topic_stream/local_collect_and_push_t020.sh`
- Default TTS URL: `http://101.227.82.130:13002/tts`
- Current default path: direct selfhosted
- Voice owner in practice: local generator config and payload `voice_id`

Relevant code:

- `scripts/topic_stream/local_collect_and_push_t020.sh:33`
- `scripts/topic_stream/run_market_radar_lab_cycle.py:10`
- `scripts/topic_stream/run_china_bigtech_cycle.py:545`
- `scripts/topic_stream/run_china_bigtech_cycle.py:808`

## Why this is considered design drift

From the product point of view, these rooms differ by show identity and preferred voice, not by voice-management architecture.

Today the implementation mixes two ownership models for the same concern:

- runtime owns the room voice for `t_017`, default `t_018`, and default `t_019`
- local generator owns the voice for default `t_020`

That split creates avoidable complexity:

- changing a room voice may require editing runtime profile in one room and a local script in another
- runtime playback voice and pre-generated MP3 voice can drift apart
- troubleshooting requires checking both room profile and generator config
- future rooms can copy the wrong pattern because both patterns look "supported"

## Practical consequence

The current system works, but the source of truth for voice is inconsistent.

If someone asks "what is the voice for this room?", the answer depends on which room and which generation path is active:

- runtime API path: inspect room TTS profile
- direct selfhosted path: inspect the generator's `audio_tts_url` and `voice_id` defaults

That is more operational complexity than the requirement calls for.

## Architecture judgment

Current judgment: this difference is not justified by user-facing requirements.

The intended steady-state principle should be:

- room voice policy should come from one place
- all topic-stream generators should follow the same selection rule by default
- direct selfhosted voice selection should exist only as an explicit diagnostic or override mode

This document records the inconsistency first. It does not yet change behavior.
