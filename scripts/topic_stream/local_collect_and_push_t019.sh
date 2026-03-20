#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PYTHON_BIN="${T019_LOCAL_PYTHON_BIN:-python}"
T019_AUDIO_TTS_VOICE="${T019_AUDIO_TTS_VOICE:-longlaotie_v3}"

VM_HOST="${T019_VM_HOST:-113.125.202.169}"
VM_PORT="${T019_VM_PORT:-21522}"
VM_USER="${T019_VM_USER:-root}"
VM_KEY="${T019_VM_KEY:-$HOME/.ssh/cn169_ed25519}"

LOCAL_JSON="${T019_LOCAL_JSON:-$REPO_ROOT/data/live/onlytrade/topic_stream/china_bigtech_live.json}"
LOCAL_IMAGE_DIR="${T019_LOCAL_IMAGE_DIR:-$REPO_ROOT/data/live/onlytrade/topic_images/t_019}"
LOCAL_AUDIO_DIR="${T019_LOCAL_AUDIO_DIR:-$REPO_ROOT/data/live/onlytrade/topic_audio/t_019}"

REMOTE_ROOT="${T019_REMOTE_ROOT:-/opt/onlytrade}"
REMOTE_JSON="${T019_REMOTE_JSON:-$REMOTE_ROOT/data/live/onlytrade/topic_stream/china_bigtech_live.json}"
REMOTE_INCOMING_JSON="${T019_REMOTE_INCOMING_JSON:-$REMOTE_ROOT/data/live/onlytrade/topic_stream/china_bigtech_live.incoming.json}"
REMOTE_IMAGE_DIR="${T019_REMOTE_IMAGE_DIR:-$REMOTE_ROOT/data/live/onlytrade/topic_images/t_019}"
REMOTE_AUDIO_DIR="${T019_REMOTE_AUDIO_DIR:-$REMOTE_ROOT/data/live/onlytrade/topic_audio/t_019}"
REMOTE_MERGE_SCRIPT="${T019_REMOTE_MERGE_SCRIPT:-$REMOTE_ROOT/scripts/topic_stream/retained_feed_merge.py}"
T019_RETAIN_LIMIT="${T019_RETAIN_LIMIT:-20}"

cd "$REPO_ROOT"

"$PYTHON_BIN" scripts/topic_stream/run_china_bigtech_cycle.py \
  --output "$LOCAL_JSON" \
  --image-dir "$LOCAL_IMAGE_DIR" \
  --audio-dir "$LOCAL_AUDIO_DIR" \
  --limit-total "${T019_LIMIT_TOTAL:-20}" \
  --per-entity-limit "${T019_PER_ENTITY_LIMIT:-4}" \
  --lookback-hours "${T019_LOOKBACK_HOURS:-72}" \
  --provider "${T019_COMMENTARY_PROVIDER:-auto}" \
  --timeout-sec "${T019_TIMEOUT_SEC:-40}" \
  --audio-tts-url "${T019_AUDIO_TTS_URL:-http://zhibo.quickdealservice.com:18000/onlytrade/api/chat/tts}" \
  --audio-timeout-sec "${T019_AUDIO_TIMEOUT_SEC:-60}" \
  --audio-tts-voice "$T019_AUDIO_TTS_VOICE"

TOPIC_COUNT="$(LOCAL_JSON_PATH="$LOCAL_JSON" $PYTHON_BIN - <<'PY'
import json
import os
from pathlib import Path
path = Path(os.getenv("LOCAL_JSON_PATH") or "")
try:
    data = json.loads(path.read_text(encoding="utf-8"))
except Exception:
    print("0")
    raise SystemExit(0)
print(int(data.get("topic_count") or 0))
PY
)"

if [ "$TOPIC_COUNT" -le 0 ]; then
  echo "[t019-local-push] generated 0 topics; skip remote publish"
  exit 3
fi

mapfile -t ASSET_ITEMS < <(
LOCAL_JSON_PATH="$LOCAL_JSON" \
LOCAL_IMAGE_DIR_PATH="$LOCAL_IMAGE_DIR" \
LOCAL_AUDIO_DIR_PATH="$LOCAL_AUDIO_DIR" \
"$PYTHON_BIN" - <<'PY'
import json
import os
from pathlib import Path

json_path = Path(os.getenv("LOCAL_JSON_PATH") or "").resolve()
img_dir = Path(os.getenv("LOCAL_IMAGE_DIR_PATH") or "").resolve()
audio_dir = Path(os.getenv("LOCAL_AUDIO_DIR_PATH") or "").resolve()

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

IMAGE_TARBALL="$TMP_DIR/t019-images.tgz"
AUDIO_TARBALL="$TMP_DIR/t019-audio.tgz"
if [ "${#IMAGE_BASENAMES[@]}" -gt 0 ]; then
  tar -czf "$IMAGE_TARBALL" -C "$LOCAL_IMAGE_DIR" "${IMAGE_BASENAMES[@]}"
fi

if [ "${#AUDIO_BASENAMES[@]}" -gt 0 ]; then
  tar -czf "$AUDIO_TARBALL" -C "$LOCAL_AUDIO_DIR" "${AUDIO_BASENAMES[@]}"
fi

ssh -p "$VM_PORT" -i "$VM_KEY" "$VM_USER@$VM_HOST" \
  "mkdir -p '$(dirname "$REMOTE_JSON")' '$(dirname "$REMOTE_INCOMING_JSON")' '$REMOTE_IMAGE_DIR' '$REMOTE_AUDIO_DIR'"

scp -P "$VM_PORT" -i "$VM_KEY" "$LOCAL_JSON" "$VM_USER@$VM_HOST:$REMOTE_INCOMING_JSON"

if [ -f "$IMAGE_TARBALL" ]; then
  scp -P "$VM_PORT" -i "$VM_KEY" "$IMAGE_TARBALL" "$VM_USER@$VM_HOST:$REMOTE_ROOT/t019-images.tgz"
fi

if [ -f "$AUDIO_TARBALL" ]; then
  scp -P "$VM_PORT" -i "$VM_KEY" "$AUDIO_TARBALL" "$VM_USER@$VM_HOST:$REMOTE_ROOT/t019-audio.tgz"
fi

if [ -f "$IMAGE_TARBALL" ] || [ -f "$AUDIO_TARBALL" ]; then
  ssh -p "$VM_PORT" -i "$VM_KEY" "$VM_USER@$VM_HOST" 'bash -s' <<REMOTE
set -euo pipefail
if [ -f "$REMOTE_ROOT/t019-images.tgz" ]; then
  tar -xzf "$REMOTE_ROOT/t019-images.tgz" -C "$REMOTE_IMAGE_DIR"
  rm -f "$REMOTE_ROOT/t019-images.tgz"
fi
if [ -f "$REMOTE_ROOT/t019-audio.tgz" ]; then
  tar -xzf "$REMOTE_ROOT/t019-audio.tgz" -C "$REMOTE_AUDIO_DIR"
  rm -f "$REMOTE_ROOT/t019-audio.tgz"
fi
REMOTE
fi

ssh -p "$VM_PORT" -i "$VM_KEY" "$VM_USER@$VM_HOST" 'bash -s' <<REMOTE
set -euo pipefail
python3 "$REMOTE_MERGE_SCRIPT" \
  --existing "$REMOTE_JSON" \
  --incoming "$REMOTE_INCOMING_JSON" \
  --output "$REMOTE_JSON" \
  --retain-limit "$T019_RETAIN_LIMIT" \
  --image-dir "$REMOTE_IMAGE_DIR" \
  --audio-dir "$REMOTE_AUDIO_DIR" \
  --room-id t_019 \
  --program-slug china-bigtech
rm -f "$REMOTE_INCOMING_JSON"
REMOTE

echo "[t019-local-push] synced json and ${#CLEAN_ASSET_ITEMS[@]} assets to $VM_HOST"
