#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PYTHON_BIN="${T017_LOCAL_PYTHON_BIN:-python}"

VM_HOST="${T017_VM_HOST:-113.125.202.169}"
VM_PORT="${T017_VM_PORT:-21522}"
VM_USER="${T017_VM_USER:-root}"
VM_KEY="${T017_VM_KEY:-$HOME/.ssh/cn169_ed25519}"

LOCAL_JSON="${T017_LOCAL_JSON:-$REPO_ROOT/data/live/onlytrade/english_classroom_live.json}"
LOCAL_IMAGE_DIR="${T017_LOCAL_IMAGE_DIR:-$REPO_ROOT/data/live/onlytrade/english_images/t_017}"
LOCAL_AUDIO_DIR="${T017_LOCAL_AUDIO_DIR:-$REPO_ROOT/data/live/onlytrade/english_audio/t_017}"
DEPLOY_FRONTEND_ONCE_FLAG="${T017_DEPLOY_FRONTEND_ONCE_FLAG:-$REPO_ROOT/data/live/onlytrade/.t017_deploy_frontend_once}"

REMOTE_ROOT="${T017_REMOTE_ROOT:-/opt/onlytrade}"
REMOTE_JSON="${T017_REMOTE_JSON:-$REMOTE_ROOT/data/live/onlytrade/english_classroom_live.json}"
REMOTE_IMAGE_DIR="${T017_REMOTE_IMAGE_DIR:-$REMOTE_ROOT/data/live/onlytrade/english_images/t_017}"
REMOTE_AUDIO_DIR="${T017_REMOTE_AUDIO_DIR:-$REMOTE_ROOT/data/live/onlytrade/english_audio/t_017}"

cd "$REPO_ROOT"

"$PYTHON_BIN" scripts/english/run_google_news_cycle.py \
  --output "$LOCAL_JSON" \
  --image-dir "$LOCAL_IMAGE_DIR" \
  --audio-dir "$LOCAL_AUDIO_DIR" \
  --limit-total "${T017_LIMIT_TOTAL:-20}" \
  --limit-per-category "${T017_LIMIT_PER_CATEGORY:-8}" \
  --material-provider "${T017_MATERIAL_PROVIDER:-auto}" \
  --material-max-items "${T017_MATERIAL_MAX_ITEMS:-8}" \
  --material-timeout-sec "${T017_MATERIAL_TIMEOUT_SEC:-35}" \
  --audio-timeout-sec "${T017_AUDIO_TIMEOUT_SEC:-60}" \
  --audio-max-items "${T017_AUDIO_MAX_ITEMS:-5}"

mapfile -t ASSET_ITEMS < <(REPO_ROOT="$REPO_ROOT" "$PYTHON_BIN" - <<'PY'
import json
import os
from pathlib import Path

root = Path(os.getenv("REPO_ROOT") or ".").resolve()
json_path = root / "data/live/onlytrade/english_classroom_live.json"
img_dir = root / "data/live/onlytrade/english_images/t_017"
audio_dir = root / "data/live/onlytrade/english_audio/t_017"

try:
    payload = json.loads(json_path.read_text(encoding="utf-8"))
except Exception:
    raise SystemExit(0)

seen = set()
for row in payload.get("headlines") or []:
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

IMAGE_TARBALL="$TMP_DIR/t017-images.tgz"
AUDIO_TARBALL="$TMP_DIR/t017-audio.tgz"

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
  scp -P "$VM_PORT" -i "$VM_KEY" "$IMAGE_TARBALL" "$VM_USER@$VM_HOST:$REMOTE_ROOT/t017-images.tgz"
fi

if [ -f "$AUDIO_TARBALL" ]; then
  scp -P "$VM_PORT" -i "$VM_KEY" "$AUDIO_TARBALL" "$VM_USER@$VM_HOST:$REMOTE_ROOT/t017-audio.tgz"
fi

if [ -f "$IMAGE_TARBALL" ] || [ -f "$AUDIO_TARBALL" ]; then
  ssh -p "$VM_PORT" -i "$VM_KEY" "$VM_USER@$VM_HOST" 'bash -s' <<REMOTE
set -euo pipefail
if [ -f "$REMOTE_ROOT/t017-images.tgz" ]; then
  tar -xzf "$REMOTE_ROOT/t017-images.tgz" -C "$REMOTE_IMAGE_DIR"
  rm -f "$REMOTE_ROOT/t017-images.tgz"
fi
if [ -f "$REMOTE_ROOT/t017-audio.tgz" ]; then
  tar -xzf "$REMOTE_ROOT/t017-audio.tgz" -C "$REMOTE_AUDIO_DIR"
  rm -f "$REMOTE_ROOT/t017-audio.tgz"
fi
REMOTE
fi

echo "[t017-local-push] synced json and ${#CLEAN_ASSET_ITEMS[@]} assets to $VM_HOST"

SHOULD_DEPLOY_FRONTEND="${T017_DEPLOY_FRONTEND:-0}"
if [ -f "$DEPLOY_FRONTEND_ONCE_FLAG" ]; then
  SHOULD_DEPLOY_FRONTEND="1"
fi

if [ "$SHOULD_DEPLOY_FRONTEND" = "1" ]; then
  bash "$REPO_ROOT/scripts/english/deploy_t017_frontend.sh"
  rm -f "$DEPLOY_FRONTEND_ONCE_FLAG"
fi
