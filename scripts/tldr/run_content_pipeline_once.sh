#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

LANDING_ROOT="${CONTENT_PIPELINE_LANDING_ROOT:-/Users/macmini-4/.openclaw/runtime/content_pipeline/landing}"
WORKSPACE_ROOT="${CONTENT_PIPELINE_WORKSPACE_ROOT:-/Users/macmini-4/.openclaw/runtime/audio_video_jobs}"

ARGS=(
  --landing-root "$LANDING_ROOT"
  --workspace-root "$WORKSPACE_ROOT"
  --once
)

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

cd "$REPO_ROOT"
uv run --with faster-whisper --with pillow python -m scripts.tldr.run_audio_card_factory "${ARGS[@]}"
