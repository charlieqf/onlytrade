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

mapfile -t ASSET_FILES < <(REPO_ROOT="$REPO_ROOT" "$PYTHON_BIN" - <<'PY'
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
            print(str(p))
PY
)

CLEAN_ASSET_FILES=()
for file_path in "${ASSET_FILES[@]}"; do
  clean_path="${file_path//$'\r'/}"
  if [ -n "$clean_path" ] && [ -f "$clean_path" ]; then
    CLEAN_ASSET_FILES+=("$clean_path")
  fi
done

ssh -p "$VM_PORT" -i "$VM_KEY" "$VM_USER@$VM_HOST" \
  "mkdir -p '$(dirname "$REMOTE_JSON")' '$REMOTE_IMAGE_DIR' '$REMOTE_AUDIO_DIR'"

scp -P "$VM_PORT" -i "$VM_KEY" "$LOCAL_JSON" "$VM_USER@$VM_HOST:$REMOTE_JSON"

if [ "${#CLEAN_ASSET_FILES[@]}" -gt 0 ]; then
  for asset_path in "${CLEAN_ASSET_FILES[@]}"; do
    remote_dir="$REMOTE_IMAGE_DIR"
    case "$asset_path" in
      "$LOCAL_AUDIO_DIR"/*)
        remote_dir="$REMOTE_AUDIO_DIR"
        ;;
    esac
    scp -P "$VM_PORT" -i "$VM_KEY" "$asset_path" "$VM_USER@$VM_HOST:$remote_dir/"
  done
fi

echo "[t017-local-push] synced json and ${#CLEAN_ASSET_FILES[@]} assets to $VM_HOST"
