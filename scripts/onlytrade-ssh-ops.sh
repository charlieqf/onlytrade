#!/usr/bin/env bash
set -euo pipefail

VM_HOST="${ONLYTRADE_VM_HOST:-root@104.238.213.119}"
VM_KEY="${ONLYTRADE_VM_KEY:-$HOME/.ssh/kamatera}"
VM_REPO="${ONLYTRADE_VM_REPO:-}"
VM_API_BASE="${ONLYTRADE_VM_API_BASE:-http://127.0.0.1:18080}"

print_help() {
  cat <<'EOF'
OnlyTrade SSH Ops Wrapper

Runs scripts/onlytrade-ops.sh on the remote VM using ssh -i.

Usage:
  bash scripts/onlytrade-ssh-ops.sh <ops-command> [args...]

Examples:
  bash scripts/onlytrade-ssh-ops.sh status
  bash scripts/onlytrade-ssh-ops.sh kill-on "manual_emergency_stop"
  bash scripts/onlytrade-ssh-ops.sh kill-off "manual_resume"
  bash scripts/onlytrade-ssh-ops.sh set-loop off
  bash scripts/onlytrade-ssh-ops.sh start-3day --speed 60 --cadence 10
  bash scripts/onlytrade-ssh-ops.sh start-3day --single-run --speed 60 --cadence 10
  bash scripts/onlytrade-ssh-ops.sh live-preflight
  bash scripts/onlytrade-ssh-ops.sh tts-status t_003
  bash scripts/onlytrade-ssh-ops.sh tts-set t_003 --provider selfhosted --voice xuanyijiangjie --fallback openai
  bash scripts/onlytrade-ssh-ops.sh tts-test t_003 --text "语音连通测试"
  bash scripts/onlytrade-ssh-ops.sh tts-clear t_003
  bash scripts/onlytrade-ssh-ops.sh viewer-sim t_003 --viewers 24 --busy high --tempo steady --duration-min 15
  OPENAI_API_KEY=... bash scripts/onlytrade-ssh-ops.sh viewer-sim t_003 --viewers 18 --busy normal --content mixed --llm-ratio 0.4
  bash scripts/onlytrade-ssh-ops.sh agent-reset t_001 --positions-only --confirm
  bash scripts/onlytrade-ssh-ops.sh factory-reset --cursor 0 --confirm

Optional env vars:
  ONLYTRADE_VM_HOST   VM SSH target (default: root@104.238.213.119)
  ONLYTRADE_VM_KEY    SSH private key path (default: ~/.ssh/kamatera)
  ONLYTRADE_VM_REPO   Repo path on VM (auto-detected if omitted)
  ONLYTRADE_VM_API_BASE Backend API base on VM (default: http://127.0.0.1:18080)

Notes:
  - Auto-detect repo path on VM from:
      /root/onlytrade, /opt/onlytrade, /home/ubuntu/onlytrade
  - If your path differs, set ONLYTRADE_VM_REPO explicitly.
EOF
}

if [ "${1:-}" = "help" ] || [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ] || [ "$#" -eq 0 ]; then
  print_help
  exit 0
fi

if [ ! -f "$VM_KEY" ]; then
  echo "[ssh-ops] ERROR: SSH key not found at $VM_KEY" >&2
  exit 1
fi

quoted_args=()
for arg in "$@"; do
  quoted_args+=("$(printf '%q' "$arg")")
done
args_joined="${quoted_args[*]}"
repo_quoted="$(printf '%q' "$VM_REPO")"
api_base_quoted="$(printf '%q' "$VM_API_BASE")"

ssh -i "$VM_KEY" "$VM_HOST" "ONLYTRADE_VM_REPO=$repo_quoted ONLYTRADE_API_BASE=$api_base_quoted bash -s -- $args_joined" <<'REMOTE_SCRIPT'
set -euo pipefail

detect_repo() {
  if [ -n "${ONLYTRADE_VM_REPO:-}" ] && [ -f "${ONLYTRADE_VM_REPO}/scripts/onlytrade-ops.sh" ]; then
    echo "${ONLYTRADE_VM_REPO}"
    return 0
  fi

  for candidate in /root/onlytrade /opt/onlytrade /home/ubuntu/onlytrade; do
    if [ -f "$candidate/scripts/onlytrade-ops.sh" ]; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

REPO_ROOT="$(detect_repo || true)"
if [ -z "$REPO_ROOT" ]; then
  echo "[ssh-ops] ERROR: could not find onlytrade repo on VM." >&2
  echo "[ssh-ops] Set ONLYTRADE_VM_REPO=/your/path/to/onlytrade and retry." >&2
  exit 1
fi

cd "$REPO_ROOT"
bash scripts/onlytrade-ops.sh "$@"
REMOTE_SCRIPT
