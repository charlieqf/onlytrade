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

  local env_file="$REPO_ROOT/mock-api/.env.local"
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
  set-cadence <bars>              Set agent decision cadence in bars
  factory-reset [--warmup|--cursor N]
                                  Reset runtime/memory/replay cursor
  kill-on [reason]                Activate emergency kill switch
  kill-off [reason]               Deactivate emergency kill switch
  stop-all [reason]               Alias of kill-on
  start-3day [--speed N] [--cadence N] [--warmup]
                                  Clean start for 3-day run
  decisions [trader_id] [limit]   Fetch latest decisions
  memory [trader_id]              Fetch agent memory snapshot(s)
  watch [seconds]                 Poll status repeatedly (default 3s)

Env vars:
  ONLYTRADE_API_BASE              API base URL (default: http://127.0.0.1:8080)
  ONLYTRADE_CONTROL_TOKEN         Control token for protected ops
  ONLYTRADE_REPLAY_SPEED          Default replay speed for start-3day (default: 60)
  ONLYTRADE_DECISION_EVERY_BARS   Default cadence for start-3day (default: 10)

Token behavior:
  - If ONLYTRADE_CONTROL_TOKEN is not set, script attempts to read CONTROL_API_TOKEN
    from mock-api/.env.local.
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

start_three_day_run() {
  local speed="$1"
  local bars="$2"
  local reset_mode="$3"

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
          *)
            echo "[ops] ERROR: unknown start-3day option $1" >&2
            exit 1
            ;;
        esac
      done
      start_three_day_run "$speed" "$bars" "$mode"
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
