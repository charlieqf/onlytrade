#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PYTHON_BIN="${T022_LOCAL_PYTHON_BIN:-python}"

PACKAGE_JSON="${T022_PACKAGE_JSON:-$REPO_ROOT/data/live/onlytrade/topic_packages/china_bigtech_packages.json}"
T019_LOCAL_JSON="${T019_LOCAL_JSON:-$REPO_ROOT/data/live/onlytrade/topic_stream/china_bigtech_live.json}"
TOPIC_IMAGE_DIR="${T022_TOPIC_IMAGE_DIR:-$REPO_ROOT/data/live/onlytrade/topic_images/t_019}"
TOPIC_AUDIO_DIR="${T022_TOPIC_AUDIO_DIR:-$REPO_ROOT/data/live/onlytrade/topic_audio/t_019}"
BATCH_MANIFEST="${T022_BATCH_MANIFEST:-$REPO_ROOT/data/live/onlytrade/content_factory/china_bigtech_factory_live.batch.json}"
LOCAL_VIDEO_DIR="${T022_LOCAL_VIDEO_DIR:-$REPO_ROOT/data/live/onlytrade/content_videos/t_022}"
LOCAL_POSTER_DIR="${T022_LOCAL_POSTER_DIR:-$REPO_ROOT/data/live/onlytrade/content_posters/t_022}"
RENDERER_DIR="${T022_RENDERER_DIR:-$REPO_ROOT/content-factory-renderer}"

VM_HOST="${T022_VM_HOST:-113.125.202.169}"
VM_PORT="${T022_VM_PORT:-21522}"
VM_USER="${T022_VM_USER:-root}"
VM_KEY="${T022_VM_KEY:-$HOME/.ssh/cn169_ed25519}"
REMOTE_ROOT="${T022_REMOTE_ROOT:-/opt/onlytrade}"
T022_RETAIN_LIMIT="${T022_RETAIN_LIMIT:-20}"

cd "$REPO_ROOT"

"$PYTHON_BIN" scripts/topic_stream/run_china_bigtech_cycle.py \
  --output "$T019_LOCAL_JSON" \
  --package-output "$PACKAGE_JSON" \
  --image-dir "$TOPIC_IMAGE_DIR" \
  --audio-dir "$TOPIC_AUDIO_DIR" \
  --limit-total "${T019_LIMIT_TOTAL:-20}" \
  --per-entity-limit "${T019_PER_ENTITY_LIMIT:-4}" \
  --lookback-hours "${T019_LOOKBACK_HOURS:-72}" \
  --provider "${T019_COMMENTARY_PROVIDER:-auto}" \
  --timeout-sec "${T019_TIMEOUT_SEC:-40}" \
  --audio-tts-url "${T019_AUDIO_TTS_URL:-http://zhibo.quickdealservice.com:18000/onlytrade/api/chat/tts}" \
  --audio-timeout-sec "${T019_AUDIO_TIMEOUT_SEC:-60}" \
  --audio-tts-voice "${T019_AUDIO_TTS_VOICE:-longlaotie_v3}"

MSYS2_ARG_CONV_EXCL='--remote-root=' "$PYTHON_BIN" scripts/content_factory/render_publish_t022_from_packages.py \
  --package-json "$PACKAGE_JSON" \
  --batch-manifest "$BATCH_MANIFEST" \
  --local-video-dir "$LOCAL_VIDEO_DIR" \
  --local-poster-dir "$LOCAL_POSTER_DIR" \
  --renderer-dir "$RENDERER_DIR" \
  --vm-host "$VM_HOST" \
  --vm-port "$VM_PORT" \
  --vm-user "$VM_USER" \
  --vm-key "$VM_KEY" \
  --remote-root="$REMOTE_ROOT" \
  --retain-limit "$T022_RETAIN_LIMIT"
