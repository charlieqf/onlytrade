#!/usr/bin/env bash
set -euo pipefail

API_BASE="${ONLYTRADE_API_BASE:-http://127.0.0.1:8080}"
DEFAULT_REPLAY_SPEED="${ONLYTRADE_REPLAY_SPEED:-60}"
DEFAULT_DECISION_BARS="${ONLYTRADE_DECISION_EVERY_BARS:-10}"
CONTROL_TOKEN="${ONLYTRADE_CONTROL_TOKEN:-}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

load_control_token_from_env_file() {
  if [ -n "$CONTROL_TOKEN" ]; then
    return
  fi

  local env_file="$REPO_ROOT/runtime-api/.env.local"
  if [ ! -f "$env_file" ]; then
    env_file="$REPO_ROOT/mock-api/.env.local"
  fi
  if [ ! -f "$env_file" ]; then
    return
  fi

  local line
  line="$(grep -E '^CONTROL_API_TOKEN=' "$env_file" | tail -n 1 || true)"
  if [ -z "$line" ]; then
    return
  fi

  local value="${line#CONTROL_API_TOKEN=}"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"

  if [ -n "$value" ]; then
    CONTROL_TOKEN="$value"
  fi
}

print_help() {
  cat <<'EOF'
OnlyTrade Ops CLI

Usage:
  bash scripts/onlytrade-ops.sh <command> [options]

Commands:
  health                          Check /health
  status                          Show health + runtime + replay status
  pause                           Pause agents + replay
  resume                          Resume agents + replay
  step [bars]                     Advance replay by bars (default 1)
  set-speed <speed>               Set replay speed multiplier
  set-loop <on|off>               Set replay loop mode
  set-cadence <bars>              Set agent decision cadence in bars
  factory-reset [--warmup|--cursor N]
                                  Reset runtime/memory/replay cursor
  kill-on [reason]                Activate emergency kill switch
  kill-off [reason]               Deactivate emergency kill switch
  stop-all [reason]               Alias of kill-on
  start-3day [--speed N] [--cadence N] [--warmup] [--single-run]
                                   Clean start for 3-day run
  akshare-run-once [--symbols CSV] Execute AKShare collect+convert one cycle
  akshare-status                  Show canonical AKShare file status
  chat-status <room_id> [user_session_id]
                                 Show chat file status for room/private
  chat-tail-public <room_id>     Tail room public chat JSONL
  chat-tail-private <room_id> <user_session_id>
                                  Tail room private chat JSONL
  agents-available                List folder-discovered agents
  agents-registered               List registered agents (registry)
  agent-register <agent_id>       Register an available agent
  agent-unregister <agent_id>     Unregister an agent
  agent-start <agent_id>          Mark agent running
  agent-stop <agent_id>           Mark agent stopped
  decisions [trader_id] [limit]   Fetch latest decisions
  memory [trader_id]              Fetch agent memory snapshot(s)
  watch [seconds]                 Poll status repeatedly (default 3s)

Env vars:
  ONLYTRADE_API_BASE              API base URL (default: http://127.0.0.1:8080)
  ONLYTRADE_CONTROL_TOKEN         Control token for protected ops
  ONLYTRADE_REPLAY_SPEED          Default replay speed for start-3day (default: 60)
  ONLYTRADE_DECISION_EVERY_BARS   Default cadence for start-3day (default: 10)
  ONLYTRADE_AKSHARE_CANONICAL     Canonical output path (default: data/live/onlytrade/frames.1m.json)

Token behavior:
  - If ONLYTRADE_CONTROL_TOKEN is not set, script attempts to read CONTROL_API_TOKEN
    from runtime-api/.env.local (fallback: mock-api/.env.local).
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[ops] ERROR: missing command '$1'" >&2
    exit 1
  fi
}

json_pretty() {
  if command -v python >/dev/null 2>&1; then
    python -m json.tool 2>/dev/null || cat
  elif command -v python3 >/dev/null 2>&1; then
    python3 -m json.tool 2>/dev/null || cat
  else
    cat
  fi
}

curl_get() {
  local path="$1"
  curl -fsS "$API_BASE$path"
}

curl_post() {
  local path="$1"
  local payload="$2"

  if [ -n "$CONTROL_TOKEN" ]; then
    curl -fsS -X POST "$API_BASE$path" \
      -H "Content-Type: application/json" \
      -H "x-control-token: $CONTROL_TOKEN" \
      -d "$payload"
  else
    curl -fsS -X POST "$API_BASE$path" \
      -H "Content-Type: application/json" \
      -d "$payload"
  fi
}

control_runtime() {
  local action="$1"
  local value="${2:-}"
  if [ -n "$value" ]; then
    curl_post "/api/agent/runtime/control" "{\"action\":\"$action\",\"decision_every_bars\":$value,\"cycle_ms\":$value}"
  else
    curl_post "/api/agent/runtime/control" "{\"action\":\"$action\"}"
  fi
}

set_replay_speed() {
  local speed="$1"
  curl_post "/api/replay/runtime/control" "{\"action\":\"set_speed\",\"speed\":$speed}"
}

set_replay_loop() {
  local mode="$1"
  local loop_json
  case "$mode" in
    on|true|1)
      loop_json="true"
      ;;
    off|false|0)
      loop_json="false"
      ;;
    *)
      echo "[ops] ERROR: set-loop requires on|off" >&2
      exit 1
      ;;
  esac
  curl_post "/api/replay/runtime/control" "{\"action\":\"set_loop\",\"loop\":$loop_json}"
}

set_decision_bars() {
  local bars="$1"
  curl_post "/api/agent/runtime/control" "{\"action\":\"set_decision_every_bars\",\"decision_every_bars\":$bars}"
}

pause_all() {
  curl_post "/api/agent/runtime/control" '{"action":"pause"}' >/dev/null
  curl_post "/api/replay/runtime/control" '{"action":"pause"}' >/dev/null
}

resume_all() {
  curl_post "/api/agent/runtime/control" '{"action":"resume"}' >/dev/null
  curl_post "/api/replay/runtime/control" '{"action":"resume"}' >/dev/null
}

kill_switch() {
  local action="$1"
  local reason="${2:-manual_ops}"
  curl_post "/api/agent/runtime/kill-switch" "{\"action\":\"$action\",\"reason\":\"$reason\"}"
}

factory_reset() {
  local mode="$1"
  local cursor="${2:-0}"

  if [ "$mode" = "warmup" ]; then
    curl_post "/api/dev/factory-reset" '{"use_warmup":true}'
  else
    curl_post "/api/dev/factory-reset" "{\"cursor_index\":$cursor}"
  fi
}

show_status() {
  echo "[ops] health"
  curl_get "/health" | json_pretty
  echo
  echo "[ops] agent runtime"
  curl_get "/api/agent/runtime/status" | json_pretty
  echo
  echo "[ops] replay runtime"
  curl_get "/api/replay/runtime/status" | json_pretty
}

watch_status() {
  local interval="$1"
  while true; do
    clear || true
    date
    echo
    show_status
    sleep "$interval"
  done
}

akshare_run_once() {
  local symbols_csv="${1:-600519,300750,601318,000001,688981}"
  local canonical_path="${ONLYTRADE_AKSHARE_CANONICAL:-data/live/onlytrade/frames.1m.json}"

  if command -v python3 >/dev/null 2>&1; then
    python3 "$REPO_ROOT/scripts/akshare/run_cycle.py" --symbols "$symbols_csv" --canonical-path "$canonical_path"
    return
  fi

  if command -v python >/dev/null 2>&1; then
    python "$REPO_ROOT/scripts/akshare/run_cycle.py" --symbols "$symbols_csv" --canonical-path "$canonical_path"
    return
  fi

  echo "[ops] ERROR: python/python3 not found for akshare-run-once" >&2
  exit 1
}

akshare_status() {
  local canonical_path="${ONLYTRADE_AKSHARE_CANONICAL:-$REPO_ROOT/data/live/onlytrade/frames.1m.json}"
  if [ ! -f "$canonical_path" ]; then
    echo "[ops] canonical file missing: $canonical_path"
    return
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 - "$canonical_path" <<'PY'
import json
import os
import sys

path = sys.argv[1]
st = os.stat(path)
with open(path, 'r', encoding='utf-8') as f:
    payload = json.load(f)
frames = payload.get('frames', [])
print(json.dumps({
    'path': path,
    'size_bytes': st.st_size,
    'mtime_epoch': st.st_mtime,
    'provider': payload.get('provider'),
    'mode': payload.get('mode'),
    'frame_count': len(frames),
    'latest_ts_ms': frames[-1]['event_ts_ms'] if frames else None,
}, ensure_ascii=False))
PY
    return
  fi

  if command -v python >/dev/null 2>&1; then
    python - "$canonical_path" <<'PY'
import json
import os
import sys

path = sys.argv[1]
st = os.stat(path)
with open(path, 'r', encoding='utf-8') as f:
    payload = json.load(f)
frames = payload.get('frames', [])
print(json.dumps({
    'path': path,
    'size_bytes': st.st_size,
    'mtime_epoch': st.st_mtime,
    'provider': payload.get('provider'),
    'mode': payload.get('mode'),
    'frame_count': len(frames),
    'latest_ts_ms': frames[-1]['event_ts_ms'] if frames else None,
}, ensure_ascii=False))
PY
    return
  fi

  echo "[ops] ERROR: python/python3 not found for akshare-status" >&2
  exit 1
}

chat_public_file() {
  local room_id="$1"
  echo "$REPO_ROOT/data/chat/rooms/$room_id/public.jsonl"
}

chat_private_file() {
  local room_id="$1"
  local user_session_id="$2"
  echo "$REPO_ROOT/data/chat/rooms/$room_id/dm/$user_session_id.jsonl"
}

print_chat_file_status() {
  local label="$1"
  local file_path="$2"

  if [ ! -f "$file_path" ]; then
    echo "[ops] $label: missing ($file_path)"
    return
  fi

  local lines
  local bytes
  local mtime
  local latest

  lines="$(wc -l < "$file_path" | tr -d ' ')"
  bytes="$(wc -c < "$file_path" | tr -d ' ')"
  mtime="$(stat -c %y "$file_path" 2>/dev/null || echo unknown)"
  latest="$(tail -n 1 "$file_path" || true)"

  echo "[ops] $label: file=$file_path lines=$lines bytes=$bytes mtime=$mtime"
  if [ -n "$latest" ]; then
    echo "[ops] $label latest:"
    printf '%s\n' "$latest" | json_pretty
  fi
}

chat_status() {
  local room_id="$1"
  local user_session_id="${2:-}"

  local public_file
  public_file="$(chat_public_file "$room_id")"
  print_chat_file_status "public" "$public_file"

  if [ -n "$user_session_id" ]; then
    local private_file
    private_file="$(chat_private_file "$room_id" "$user_session_id")"
    print_chat_file_status "private" "$private_file"
  fi
}

chat_tail_public() {
  local room_id="$1"
  local file_path
  file_path="$(chat_public_file "$room_id")"

  if [ ! -f "$file_path" ]; then
    echo "[ops] ERROR: public chat file missing: $file_path" >&2
    exit 1
  fi

  tail -n 40 -f "$file_path"
}

chat_tail_private() {
  local room_id="$1"
  local user_session_id="$2"
  local file_path
  file_path="$(chat_private_file "$room_id" "$user_session_id")"

  if [ ! -f "$file_path" ]; then
    echo "[ops] ERROR: private chat file missing: $file_path" >&2
    exit 1
  fi

  tail -n 40 -f "$file_path"
}

agents_available() {
  curl_get "/api/agents/available"
}

agents_registered() {
  curl_get "/api/agents/registered"
}

agent_register() {
  local agent_id="$1"
  curl_post "/api/agents/$agent_id/register" '{}'
}

agent_unregister() {
  local agent_id="$1"
  curl_post "/api/agents/$agent_id/unregister" '{}'
}

agent_start() {
  local agent_id="$1"
  curl_post "/api/agents/$agent_id/start" '{}'
}

agent_stop() {
  local agent_id="$1"
  curl_post "/api/agents/$agent_id/stop" '{}'
}

start_three_day_run() {
  local speed="$1"
  local bars="$2"
  local reset_mode="$3"
  local loop_mode="$4"

  echo "[ops] start-3day: activating clean baseline"
  if [ "$reset_mode" = "warmup" ]; then
    factory_reset warmup | json_pretty
  else
    factory_reset cursor 0 | json_pretty
  fi

  echo "[ops] ensuring kill switch is OFF"
  kill_switch deactivate "start_3day_run" >/dev/null || true

  echo "[ops] setting replay speed=$speed"
  set_replay_speed "$speed" >/dev/null

  echo "[ops] setting replay loop mode=$loop_mode"
  set_replay_loop "$loop_mode" >/dev/null

  echo "[ops] setting decision cadence bars=$bars"
  set_decision_bars "$bars" >/dev/null

  echo "[ops] resuming runtime + replay"
  resume_all

  echo "[ops] done"
  show_status
}

main() {
  require_command curl
  load_control_token_from_env_file

  local cmd="${1:-help}"
  shift || true

  case "$cmd" in
    help|-h|--help)
      print_help
      ;;
    health)
      curl_get "/health" | json_pretty
      ;;
    status)
      show_status
      ;;
    pause)
      pause_all
      show_status
      ;;
    resume)
      resume_all
      show_status
      ;;
    step)
      local bars="${1:-1}"
      curl_post "/api/replay/runtime/control" "{\"action\":\"step\",\"bars\":$bars}" | json_pretty
      ;;
    set-speed)
      local speed="${1:-}"
      if [ -z "$speed" ]; then
        echo "[ops] ERROR: set-speed requires value" >&2
        exit 1
      fi
      set_replay_speed "$speed" | json_pretty
      ;;
    set-loop)
      local mode="${1:-}"
      if [ -z "$mode" ]; then
        echo "[ops] ERROR: set-loop requires on|off" >&2
        exit 1
      fi
      set_replay_loop "$mode" | json_pretty
      ;;
    set-cadence)
      local bars="${1:-}"
      if [ -z "$bars" ]; then
        echo "[ops] ERROR: set-cadence requires value" >&2
        exit 1
      fi
      set_decision_bars "$bars" | json_pretty
      ;;
    factory-reset)
      local mode="cursor"
      local cursor="0"
      while [ "$#" -gt 0 ]; do
        case "$1" in
          --warmup)
            mode="warmup"
            shift
            ;;
          --cursor)
            cursor="$2"
            shift 2
            ;;
          *)
            echo "[ops] ERROR: unknown factory-reset option $1" >&2
            exit 1
            ;;
        esac
      done
      factory_reset "$mode" "$cursor" | json_pretty
      ;;
    kill-on|stop-all)
      local reason="${1:-manual_emergency_stop}"
      kill_switch activate "$reason" | json_pretty
      ;;
    kill-off)
      local reason="${1:-manual_resume}"
      kill_switch deactivate "$reason" | json_pretty
      ;;
    start-3day)
      local speed="$DEFAULT_REPLAY_SPEED"
      local bars="$DEFAULT_DECISION_BARS"
      local mode="cursor"
      local loop_mode="on"
      while [ "$#" -gt 0 ]; do
        case "$1" in
          --speed)
            speed="$2"
            shift 2
            ;;
          --cadence)
            bars="$2"
            shift 2
            ;;
          --warmup)
            mode="warmup"
            shift
            ;;
          --single-run)
            loop_mode="off"
            shift
            ;;
          --loop)
            loop_mode="on"
            shift
            ;;
          *)
            echo "[ops] ERROR: unknown start-3day option $1" >&2
            exit 1
            ;;
        esac
      done
      start_three_day_run "$speed" "$bars" "$mode" "$loop_mode"
      ;;
    akshare-run-once)
      local symbols_csv="600519,300750,601318,000001,688981"
      while [ "$#" -gt 0 ]; do
        case "$1" in
          --symbols)
            symbols_csv="$2"
            shift 2
            ;;
          *)
            echo "[ops] ERROR: unknown akshare-run-once option $1" >&2
            exit 1
            ;;
        esac
      done
      akshare_run_once "$symbols_csv"
      ;;
    akshare-status)
      akshare_status
      ;;
    chat-status)
      local room_id="${1:-}"
      local user_session_id="${2:-}"
      if [ -z "$room_id" ]; then
        echo "[ops] ERROR: chat-status requires <room_id>" >&2
        exit 1
      fi
      chat_status "$room_id" "$user_session_id"
      ;;
    chat-tail-public)
      local room_id="${1:-}"
      if [ -z "$room_id" ]; then
        echo "[ops] ERROR: chat-tail-public requires <room_id>" >&2
        exit 1
      fi
      chat_tail_public "$room_id"
      ;;
    chat-tail-private)
      local room_id="${1:-}"
      local user_session_id="${2:-}"
      if [ -z "$room_id" ] || [ -z "$user_session_id" ]; then
        echo "[ops] ERROR: chat-tail-private requires <room_id> <user_session_id>" >&2
        exit 1
      fi
      chat_tail_private "$room_id" "$user_session_id"
      ;;
    agents-available)
      agents_available | json_pretty
      ;;
    agents-registered)
      agents_registered | json_pretty
      ;;
    agent-register)
      local agent_id="${1:-}"
      if [ -z "$agent_id" ]; then
        echo "[ops] ERROR: agent-register requires <agent_id>" >&2
        exit 1
      fi
      agent_register "$agent_id" | json_pretty
      ;;
    agent-unregister)
      local agent_id="${1:-}"
      if [ -z "$agent_id" ]; then
        echo "[ops] ERROR: agent-unregister requires <agent_id>" >&2
        exit 1
      fi
      agent_unregister "$agent_id" | json_pretty
      ;;
    agent-start)
      local agent_id="${1:-}"
      if [ -z "$agent_id" ]; then
        echo "[ops] ERROR: agent-start requires <agent_id>" >&2
        exit 1
      fi
      agent_start "$agent_id" | json_pretty
      ;;
    agent-stop)
      local agent_id="${1:-}"
      if [ -z "$agent_id" ]; then
        echo "[ops] ERROR: agent-stop requires <agent_id>" >&2
        exit 1
      fi
      agent_stop "$agent_id" | json_pretty
      ;;
    decisions)
      local trader="${1:-}"
      local limit="${2:-10}"
      if [ -n "$trader" ]; then
        curl_get "/api/decisions/latest?trader_id=$trader&limit=$limit" | json_pretty
      else
        curl_get "/api/decisions/latest?limit=$limit" | json_pretty
      fi
      ;;
    memory)
      local trader="${1:-}"
      if [ -n "$trader" ]; then
        curl_get "/api/agent/memory?trader_id=$trader" | json_pretty
      else
        curl_get "/api/agent/memory" | json_pretty
      fi
      ;;
    watch)
      local seconds="${1:-3}"
      watch_status "$seconds"
      ;;
    *)
      echo "[ops] ERROR: unknown command '$cmd'" >&2
      print_help
      exit 1
      ;;
  esac
}

main "$@"
