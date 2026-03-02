#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

LOCAL_OUTPUT="${ONLYTRADE_X_HOT_OUTPUT:-$REPO_ROOT/data/live/onlytrade/x_hot_events.json}"
VM_HOST="${ONLYTRADE_X_VM_HOST:-root@113.125.202.169}"
VM_PORT="${ONLYTRADE_X_VM_PORT:-21522}"
VM_KEY="${ONLYTRADE_X_VM_KEY:-$HOME/.ssh/cn169_ed25519}"
REMOTE_PATH="${ONLYTRADE_X_REMOTE_PATH:-/opt/onlytrade/data/live/onlytrade/x_hot_events.json}"

PUSH_ONLY="false"
COLLECT_ONLY="false"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output)
      LOCAL_OUTPUT="$2"
      shift 2
      ;;
    --vm-host)
      VM_HOST="$2"
      shift 2
      ;;
    --vm-port)
      VM_PORT="$2"
      shift 2
      ;;
    --vm-key)
      VM_KEY="$2"
      shift 2
      ;;
    --remote-path)
      REMOTE_PATH="$2"
      shift 2
      ;;
    --push-only)
      PUSH_ONLY="true"
      shift
      ;;
    --collect-only)
      COLLECT_ONLY="true"
      shift
      ;;
    --help)
      cat <<'EOF'
Usage: bash scripts/x_hot_news_push.sh [options]

Options:
  --output <path>         Local output JSON path
  --vm-host <ssh_target>  VM ssh target (default root@113.125.202.169)
  --vm-port <port>        VM ssh port (default 21522)
  --vm-key <path>         SSH private key path
  --remote-path <path>    VM destination path
  --push-only             Skip local collect and push existing file
  --collect-only          Collect locally but do not push

Notes:
  - Extra args are forwarded to scripts/x_hot_news_collector.py
  - Set X_BEARER_TOKEN to enable X API mode in collector
EOF
      exit 0
      ;;
    *)
      break
      ;;
  esac
done

run_python() {
  if command -v python3 >/dev/null 2>&1 && python3 -V >/dev/null 2>&1; then
    python3 "$@"
    return 0
  fi
  if command -v py >/dev/null 2>&1 && py -3 -V >/dev/null 2>&1; then
    py -3 "$@"
    return 0
  fi
  if command -v python >/dev/null 2>&1 && python -V >/dev/null 2>&1; then
    python "$@"
    return 0
  fi
  echo "[x-hot] ERROR: python runtime not found (python3/py/python)" >&2
  exit 1
}

json_headline_count() {
  local file_path="$1"
  run_python - "$file_path" <<'PY'
import json
import sys

path = sys.argv[1]
try:
    with open(path, 'r', encoding='utf-8') as f:
        payload = json.load(f)
    print(int(payload.get('headline_count') or 0))
except Exception:
    print(0)
PY
}

mkdir -p "$(dirname "$LOCAL_OUTPUT")"

if [ "$PUSH_ONLY" != "true" ]; then
  echo "[x-hot] collecting latest X hot events -> $LOCAL_OUTPUT"
  run_python "$REPO_ROOT/scripts/x_hot_news_collector.py" --output "$LOCAL_OUTPUT" "$@"
fi

if [ "$COLLECT_ONLY" = "true" ]; then
  echo "[x-hot] collect-only mode done"
  exit 0
fi

if [ ! -f "$LOCAL_OUTPUT" ]; then
  echo "[x-hot] ERROR: local output not found: $LOCAL_OUTPUT" >&2
  exit 1
fi

HEADLINE_COUNT="$(json_headline_count "$LOCAL_OUTPUT")"
ALLOW_EMPTY_PUSH="${ONLYTRADE_X_ALLOW_EMPTY_PUSH:-false}"
if [ "$HEADLINE_COUNT" -le 0 ] && [ "${ALLOW_EMPTY_PUSH,,}" != "true" ]; then
  echo "[x-hot] WARN: headline_count=0, skip VM push to preserve previous remote snapshot"
  echo "[x-hot] set ONLYTRADE_X_ALLOW_EMPTY_PUSH=true to force pushing empty payload"
  exit 0
fi

REMOTE_DIR="$(dirname "$REMOTE_PATH")"
REMOTE_TMP="/tmp/x_hot_events.json"

echo "[x-hot] pushing file to VM $VM_HOST:$REMOTE_PATH"
scp -i "$VM_KEY" -P "$VM_PORT" "$LOCAL_OUTPUT" "$VM_HOST:$REMOTE_TMP"
ssh -i "$VM_KEY" -p "$VM_PORT" "$VM_HOST" "mkdir -p '$REMOTE_DIR' && cp '$REMOTE_TMP' '$REMOTE_PATH' && ls -l '$REMOTE_PATH'"

echo "[x-hot] done"
