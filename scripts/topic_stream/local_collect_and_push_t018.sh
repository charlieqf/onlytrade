#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PYTHON_BIN="${T018_LOCAL_PYTHON_BIN:-python}"
T018_AUDIO_TTS_VOICE="${T018_AUDIO_TTS_VOICE:-longlaotie_v3}"
T018_AUDIO_TTS_SPEED="${T018_AUDIO_TTS_SPEED:-1.2}"

VM_HOST="${T018_VM_HOST:-113.125.202.169}"
VM_PORT="${T018_VM_PORT:-21522}"
VM_USER="${T018_VM_USER:-root}"
VM_KEY="${T018_VM_KEY:-$HOME/.ssh/cn169_ed25519}"

LOCAL_JSON="${T018_LOCAL_JSON:-$REPO_ROOT/data/live/onlytrade/topic_stream/five_league_live.json}"
LOCAL_IMAGE_DIR="${T018_LOCAL_IMAGE_DIR:-$REPO_ROOT/data/live/onlytrade/topic_images/t_018}"
LOCAL_AUDIO_DIR="${T018_LOCAL_AUDIO_DIR:-$REPO_ROOT/data/live/onlytrade/topic_audio/t_018}"

REMOTE_ROOT="${T018_REMOTE_ROOT:-/opt/onlytrade}"
REMOTE_JSON="${T018_REMOTE_JSON:-$REMOTE_ROOT/data/live/onlytrade/topic_stream/five_league_live.json}"
REMOTE_IMAGE_DIR="${T018_REMOTE_IMAGE_DIR:-$REMOTE_ROOT/data/live/onlytrade/topic_images/t_018}"
REMOTE_AUDIO_DIR="${T018_REMOTE_AUDIO_DIR:-$REMOTE_ROOT/data/live/onlytrade/topic_audio/t_018}"

cd "$REPO_ROOT"

"$PYTHON_BIN" scripts/topic_stream/run_five_league_cycle.py \
  --output "$LOCAL_JSON" \
  --image-dir "$LOCAL_IMAGE_DIR" \
  --audio-dir "$LOCAL_AUDIO_DIR" \
  --limit-total "${T018_LIMIT_TOTAL:-10}" \
  --per-entity-limit "${T018_PER_ENTITY_LIMIT:-4}" \
  --lookback-hours "${T018_LOOKBACK_HOURS:-72}" \
  --provider "${T018_COMMENTARY_PROVIDER:-auto}" \
  --timeout-sec "${T018_TIMEOUT_SEC:-40}" \
  --audio-tts-url "${T018_AUDIO_TTS_URL:-http://zhibo.quickdealservice.com:18000/onlytrade/api/chat/tts}" \
  --audio-timeout-sec "${T018_AUDIO_TIMEOUT_SEC:-60}" \
  --audio-tts-voice "$T018_AUDIO_TTS_VOICE" \
  --audio-tts-speed "$T018_AUDIO_TTS_SPEED"

mapfile -t ASSET_ITEMS < <(REPO_ROOT="$REPO_ROOT" "$PYTHON_BIN" - <<'PY'
import json
import os
from pathlib import Path

root = Path(os.getenv("REPO_ROOT") or ".").resolve()
json_path = root / "data/live/onlytrade/topic_stream/five_league_live.json"
img_dir = root / "data/live/onlytrade/topic_images/t_018"
audio_dir = root / "data/live/onlytrade/topic_audio/t_018"

try:
    payload = json.loads(json_path.read_text(encoding="utf-8"))
except Exception:
    raise SystemExit(0)

seen = set()
for row in payload.get("topics") or []:
    item = row or {}
    for base_dir, field in ((img_dir, "image_file"), (audio_dir, "audio_file")):
        name = str(item.get(field) or "").strip()
        if not name:
            continue
        key = f"{field}:{name}"
        if key in seen:
            continue
        p = (base_dir / name).resolve()
        if p.exists() and p.is_file():
            seen.add(key)
            kind = "audio" if field == "audio_file" else "image"
            print(f"{kind}\t{p}")
PY
)

CLEAN_ASSET_ITEMS=()
for item in "${ASSET_ITEMS[@]}"; do
  clean_item="${item//$'\r'/}"
  if [ -z "$clean_item" ]; then
    continue
  fi
  kind="${clean_item%%$'\t'*}"
  file_path="${clean_item#*$'\t'}"
  if [ -n "$kind" ] && [ -n "$file_path" ] && [ -f "$file_path" ]; then
    CLEAN_ASSET_ITEMS+=("${kind}"$'\t'"${file_path}")
  fi
done

IMAGE_BASENAMES=()
AUDIO_BASENAMES=()
for asset_item in "${CLEAN_ASSET_ITEMS[@]}"; do
  kind="${asset_item%%$'\t'*}"
  asset_path="${asset_item#*$'\t'}"
  asset_name="$(basename "$asset_path")"
  if [ "$kind" = "audio" ]; then
    AUDIO_BASENAMES+=("$asset_name")
  else
    IMAGE_BASENAMES+=("$asset_name")
  fi
done

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

IMAGE_TARBALL="$TMP_DIR/t018-images.tgz"
AUDIO_TARBALL="$TMP_DIR/t018-audio.tgz"

if [ "${#IMAGE_BASENAMES[@]}" -gt 0 ]; then
  tar -czf "$IMAGE_TARBALL" -C "$LOCAL_IMAGE_DIR" "${IMAGE_BASENAMES[@]}"
fi

if [ "${#AUDIO_BASENAMES[@]}" -gt 0 ]; then
  tar -czf "$AUDIO_TARBALL" -C "$LOCAL_AUDIO_DIR" "${AUDIO_BASENAMES[@]}"
fi

ssh -p "$VM_PORT" -i "$VM_KEY" "$VM_USER@$VM_HOST" \
  "mkdir -p '$(dirname "$REMOTE_JSON")' '$REMOTE_IMAGE_DIR' '$REMOTE_AUDIO_DIR'"

scp -P "$VM_PORT" -i "$VM_KEY" "$LOCAL_JSON" "$VM_USER@$VM_HOST:$REMOTE_JSON"

if [ -f "$IMAGE_TARBALL" ]; then
  scp -P "$VM_PORT" -i "$VM_KEY" "$IMAGE_TARBALL" "$VM_USER@$VM_HOST:$REMOTE_ROOT/t018-images.tgz"
fi

if [ -f "$AUDIO_TARBALL" ]; then
  scp -P "$VM_PORT" -i "$VM_KEY" "$AUDIO_TARBALL" "$VM_USER@$VM_HOST:$REMOTE_ROOT/t018-audio.tgz"
fi

if [ -f "$IMAGE_TARBALL" ] || [ -f "$AUDIO_TARBALL" ]; then
  ssh -p "$VM_PORT" -i "$VM_KEY" "$VM_USER@$VM_HOST" 'bash -s' <<REMOTE
set -euo pipefail
if [ -f "$REMOTE_ROOT/t018-images.tgz" ]; then
  tar -xzf "$REMOTE_ROOT/t018-images.tgz" -C "$REMOTE_IMAGE_DIR"
  rm -f "$REMOTE_ROOT/t018-images.tgz"
fi
if [ -f "$REMOTE_ROOT/t018-audio.tgz" ]; then
  tar -xzf "$REMOTE_ROOT/t018-audio.tgz" -C "$REMOTE_AUDIO_DIR"
  rm -f "$REMOTE_ROOT/t018-audio.tgz"
fi
REMOTE
fi

echo "[t018-local-push] synced json and ${#CLEAN_ASSET_ITEMS[@]} assets to $VM_HOST"
