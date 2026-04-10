#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARGS=(--workspace-root "$SCRIPT_DIR/runtime/workspace")

if [[ -n "${CONTENT_PIPELINE_LANDING_ROOT:-}" ]]; then
  ARGS+=(--landing-root "$CONTENT_PIPELINE_LANDING_ROOT")
else
  ARGS+=(--input-dir "$SCRIPT_DIR/runtime/input")
fi

if [[ -n "${CONTENT_PIPELINE_DRIVE_ROOT_ID:-}" ]]; then
  ARGS+=(--drive-root-id "$CONTENT_PIPELINE_DRIVE_ROOT_ID")
fi

if [[ -n "${CONTENT_PIPELINE_DRIVE_ACCOUNT:-}" ]]; then
  ARGS+=(--drive-account "$CONTENT_PIPELINE_DRIVE_ACCOUNT")
fi

if [[ -n "${CONTENT_PIPELINE_REPLY_ACCOUNT:-}" ]]; then
  ARGS+=(--reply-account "$CONTENT_PIPELINE_REPLY_ACCOUNT")
fi

if [[ "${CONTENT_PIPELINE_REPLY_AFTER_UPLOAD:-}" =~ ^(1|true|TRUE|yes|YES|on|ON)$ ]]; then
  ARGS+=(--reply-after-upload)
fi

uv run --with faster-whisper --with pillow python -m scripts.tldr.run_audio_card_factory \
  "${ARGS[@]}"
