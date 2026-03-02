#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

MODE="${ONLYTRADE_T003_SWITCH_MODE:-ssh}"
ROOM_ID="${ONLYTRADE_T003_ROOM_ID:-t_003}"
VM_HOST="${ONLYTRADE_VM_HOST:-root@113.125.202.169}"
VM_PORT="${ONLYTRADE_VM_PORT:-21522}"
VM_KEY="${ONLYTRADE_VM_KEY:-$HOME/.ssh/cn169_ed25519}"
VM_API_BASE="${ONLYTRADE_VM_API_BASE:-http://127.0.0.1:18080}"
API_BASE="${ONLYTRADE_API_BASE:-http://127.0.0.1:8080}"

SELFHOSTED_VOICE="${ONLYTRADE_SELFHOSTED_VOICE:-zsy}"
COSY_VOICE_DEFAULT="longanhuan"
COSY_ALLOWED_VOICES="longanhuan longanwen_v3 longyan_v3 longwan_v3 longfeifei_v3"
RUN_TEST="true"

print_help() {
  cat <<'EOF'
Hot-switch voice profile for t_003.

Usage:
  bash scripts/t003-voice-hot-switch.sh <action> [options]

Actions:
  status        Show room TTS status/profile
  zsy           Switch to self-hosted zsy (provider=selfhosted, fallback=openai)
  cosy          Switch to Aliyun cosyvoice female through selfhosted gateway

Options:
  --mode ssh|local         Default: ssh
  --room <room_id>         Default: t_003
  --vm-host <ssh_target>   Default: root@113.125.202.169
  --vm-port <port>         Default: 21522
  --vm-key <path>          Default: ~/.ssh/cn169_ed25519
  --vm-api <url>           Default: http://127.0.0.1:18080
  --api <url>              Local mode API base (default http://127.0.0.1:8080)
  --cosy-voice <id>        Force cosy voice id (allowed set only)
  --self-voice <id>        Self-hosted voice id (default zsy)
  --no-test                Do not run tts-test after switch

Allowed cosy female voices:
  longanhuan, longanwen_v3, longyan_v3, longwan_v3, longfeifei_v3

Examples:
  bash scripts/t003-voice-hot-switch.sh status
  bash scripts/t003-voice-hot-switch.sh zsy
  bash scripts/t003-voice-hot-switch.sh cosy
EOF
}

json_unquote() {
  local raw="$1"
  raw="${raw%\"}"
  raw="${raw#\"}"
  raw="${raw%\'}"
  raw="${raw#\'}"
  printf '%s' "$raw"
}

resolve_repo_root_on_vm() {
  ssh -p "$VM_PORT" -i "$VM_KEY" "$VM_HOST" 'for d in /opt/onlytrade /root/onlytrade /home/ubuntu/onlytrade; do if [ -f "$d/scripts/onlytrade-ops.sh" ]; then echo "$d"; exit 0; fi; done; exit 1'
}

detect_cosy_voice_from_env_file_local() {
  local env_file="$REPO_ROOT/runtime-api/.env.local"
  if [ ! -f "$env_file" ]; then
    return 1
  fi
  local line
  line="$(grep -E '^CHAT_TTS_VOICE_FEMALE_1=' "$env_file" | tail -n 1 || true)"
  if [ -z "$line" ]; then
    return 1
  fi
  json_unquote "${line#CHAT_TTS_VOICE_FEMALE_1=}"
  return 0
}

detect_cosy_voice_from_env_file_vm() {
  local vm_repo
  vm_repo="$(resolve_repo_root_on_vm)"
  local line
  line="$(ssh -p "$VM_PORT" -i "$VM_KEY" "$VM_HOST" "f='$vm_repo/runtime-api/.env.local'; if [ -f \"\$f\" ]; then grep -E '^CHAT_TTS_VOICE_FEMALE_1=' \"\$f\" | tail -n 1 || true; fi")"
  if [ -z "$line" ]; then
    return 1
  fi
  json_unquote "${line#CHAT_TTS_VOICE_FEMALE_1=}"
  return 0
}

is_allowed_cosy_voice() {
  local voice="$1"
  local v
  for v in $COSY_ALLOWED_VOICES; do
    if [ "$voice" = "$v" ]; then
      return 0
    fi
  done
  return 1
}

normalize_cosy_voice() {
  local candidate="$1"
  if [ -n "$candidate" ] && is_allowed_cosy_voice "$candidate"; then
    printf '%s' "$candidate"
    return 0
  fi
  if [ -n "$candidate" ]; then
    echo "[voice-switch] WARN: unsupported cosy voice '$candidate', fallback to '$COSY_VOICE_DEFAULT'" >&2
  fi
  printf '%s' "$COSY_VOICE_DEFAULT"
}

resolve_cosy_voice() {
  local forced="${ONLYTRADE_COSY_FEMALE_VOICE:-}"
  if [ -n "$forced" ]; then
    normalize_cosy_voice "$forced"
    return 0
  fi
  if [ "$MODE" = "local" ]; then
    local detected=""
    detected="$(detect_cosy_voice_from_env_file_local || true)"
    normalize_cosy_voice "$detected"
    return 0
  fi
  local detected=""
  detected="$(detect_cosy_voice_from_env_file_vm || true)"
  normalize_cosy_voice "$detected"
}

run_ops() {
  if [ "$MODE" = "local" ]; then
    ONLYTRADE_API_BASE="$API_BASE" bash "$REPO_ROOT/scripts/onlytrade-ops.sh" "$@"
    return 0
  fi
  if [ ! -f "$VM_KEY" ]; then
    echo "[voice-switch] ERROR: SSH key not found: $VM_KEY" >&2
    exit 1
  fi
  local quoted_args=()
  local arg
  for arg in "$@"; do
    quoted_args+=("$(printf '%q' "$arg")")
  done
  local args_joined="${quoted_args[*]}"
  local api_base_quoted
  api_base_quoted="$(printf '%q' "$VM_API_BASE")"

  ssh -p "$VM_PORT" -i "$VM_KEY" "$VM_HOST" "ONLYTRADE_API_BASE=$api_base_quoted bash -s -- $args_joined" <<'REMOTE_SCRIPT'
set -euo pipefail

detect_repo() {
  for candidate in /opt/onlytrade /root/onlytrade /home/ubuntu/onlytrade; do
    if [ -f "$candidate/scripts/onlytrade-ops.sh" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

REPO_ROOT="$(detect_repo || true)"
if [ -z "$REPO_ROOT" ]; then
  echo "[voice-switch] ERROR: could not find onlytrade repo on VM" >&2
  exit 1
fi

cd "$REPO_ROOT"
bash scripts/onlytrade-ops.sh "$@"
REMOTE_SCRIPT
}

ACTION="${1:-help}"
if [ "$ACTION" = "help" ] || [ "$ACTION" = "--help" ] || [ "$ACTION" = "-h" ]; then
  print_help
  exit 0
fi
shift || true

while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --room)
      ROOM_ID="${2:-}"
      shift 2
      ;;
    --vm-host)
      VM_HOST="${2:-}"
      shift 2
      ;;
    --vm-key)
      VM_KEY="${2:-}"
      shift 2
      ;;
    --vm-port)
      VM_PORT="${2:-}"
      shift 2
      ;;
    --vm-api)
      VM_API_BASE="${2:-}"
      shift 2
      ;;
    --api)
      API_BASE="${2:-}"
      shift 2
      ;;
    --cosy-voice)
      ONLYTRADE_COSY_FEMALE_VOICE="${2:-}"
      export ONLYTRADE_COSY_FEMALE_VOICE
      shift 2
      ;;
    --self-voice)
      SELFHOSTED_VOICE="${2:-}"
      shift 2
      ;;
    --no-test)
      RUN_TEST="false"
      shift
      ;;
    *)
      echo "[voice-switch] ERROR: unknown option $1" >&2
      exit 1
      ;;
  esac
done

case "$MODE" in
  ssh|local)
    ;;
  *)
    echo "[voice-switch] ERROR: --mode must be ssh|local" >&2
    exit 1
    ;;
esac

case "$ACTION" in
  status)
    run_ops tts-status "$ROOM_ID"
    ;;
  zsy)
    echo "[voice-switch] switching room=$ROOM_ID -> selfhosted/$SELFHOSTED_VOICE"
    run_ops tts-set "$ROOM_ID" --provider selfhosted --voice "$SELFHOSTED_VOICE" --fallback openai
    if [ "$RUN_TEST" = "true" ]; then
      run_ops tts-test "$ROOM_ID" --text "语音切换测试，自建 zsy"
    fi
    run_ops tts-status "$ROOM_ID"
    ;;
  cosy)
    COSY_VOICE="$(resolve_cosy_voice)"
    if ! is_allowed_cosy_voice "$COSY_VOICE"; then
      echo "[voice-switch] ERROR: resolved cosy voice is not allowed: $COSY_VOICE" >&2
      exit 1
    fi
    echo "[voice-switch] switching room=$ROOM_ID -> selfhosted/$COSY_VOICE (aliyun cosyvoice via gateway)"
    run_ops tts-set "$ROOM_ID" --provider selfhosted --voice "$COSY_VOICE" --fallback none
    if [ "$RUN_TEST" = "true" ]; then
      run_ops tts-test "$ROOM_ID" --text "语音切换测试，阿里云 cosy 女声"
    fi
    run_ops tts-status "$ROOM_ID"
    ;;
  *)
    echo "[voice-switch] ERROR: action must be status|zsy|cosy" >&2
    exit 1
    ;;
esac
