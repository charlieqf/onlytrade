#!/usr/bin/env bash
set -euo pipefail

API_BASE="${ONLYTRADE_API_BASE:-http://127.0.0.1:8080}"
DEFAULT_REPLAY_SPEED="${ONLYTRADE_REPLAY_SPEED:-60}"
DEFAULT_DECISION_BARS="${ONLYTRADE_DECISION_EVERY_BARS:-10}"
CONTROL_TOKEN="${ONLYTRADE_CONTROL_TOKEN:-}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
AKSHARE_PYTHON="${ONLYTRADE_AKSHARE_PYTHON:-$REPO_ROOT/.venv-akshare/bin/python}"

load_control_token_from_env_file() {
  if [ -n "$CONTROL_TOKEN" ]; then
    return
  fi

  local env_file="$REPO_ROOT/runtime-api/.env.local"
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
  factory-reset [--warmup|--cursor N] --confirm [--dry-run]
                                   Reset runtime/memory/replay cursor
  agent-reset <agent_id> (--full|--positions-only) --confirm [--dry-run]
                                  Reset one agent safely (scoped)
  live-preflight                  Show live mode preflight checks
  check-live-freshness [--strict] Validate live data file freshness thresholds
  continuity-snapshot [output]    Snapshot data/agent-memory continuity state
  health-restart-probe            Health check + listener probe on API port
  kill-on [reason]                Activate emergency kill switch
  kill-off [reason]               Deactivate emergency kill switch
  stop-all [reason]               Alias of kill-on
  start-3day [--speed N] [--cadence N] [--warmup] [--single-run]
                                   Clean start for 3-day run
  akshare-run-once [--symbols CSV] Execute AKShare collect+convert one cycle
  akshare-status                  Show canonical AKShare file status
  market-overview-us-run-once      Build US market_overview.us.json once
  market-overview-us-if-open       Build US market_overview.us.json if market open
  market-overview-cn-run-once      Build CN-A market_overview.cn-a.json once
  market-overview-cn-if-open       Build CN-A market_overview.cn-a.json if market open
  news-digest-us-run-once          Build US news_digest.us.json once (best-effort)
  news-digest-cn-run-once          Build CN-A news_digest.cn-a.json once (best-effort)
  red-blue-cn-run-once             Build CN-A market_breadth.cn-a.json once
  red-blue-cn-if-open              Build CN-A market_breadth.cn-a.json if market open
  red-blue-replay-build            Build replay market_breadth.1m.json from replay frames
                                  Options: --frames-path --output-path --day-key YYYY-MM-DD
  overview-status                  Show overview + digest file statuses
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
  ONLYTRADE_AKSHARE_PYTHON        Python interpreter for AKShare jobs (default: .venv-akshare/bin/python)

Token behavior:
  - If ONLYTRADE_CONTROL_TOKEN is not set, script attempts to read CONTROL_API_TOKEN
    from runtime-api/.env.local.
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
  local dry_run="${3:-false}"

  if [ "$mode" = "warmup" ]; then
    curl_post "/api/dev/factory-reset" "{\"use_warmup\":true,\"confirm\":\"RESET\",\"dry_run\":$dry_run}"
  else
    curl_post "/api/dev/factory-reset" "{\"cursor_index\":$cursor,\"confirm\":\"RESET\",\"dry_run\":$dry_run}"
  fi
}

agent_reset() {
  local agent_id="$1"
  local reset_memory="$2"
  local reset_positions="$3"
  local reset_stats="$4"
  local dry_run="${5:-false}"

  curl_post "/api/dev/reset-agent" "{\"trader_id\":\"$agent_id\",\"reset_memory\":$reset_memory,\"reset_positions\":$reset_positions,\"reset_stats\":$reset_stats,\"confirm\":\"$agent_id\",\"dry_run\":$dry_run}"
}

live_preflight() {
  curl_get "/api/ops/live-preflight"
}

check_live_freshness() {
  local strict="${1:-false}"
  local script_path="$REPO_ROOT/scripts/ops/check_live_data_freshness.py"
  if [ ! -f "$script_path" ]; then
    echo "[ops] ERROR: missing script: $script_path" >&2
    exit 1
  fi

  if command -v python3 >/dev/null 2>&1; then
    if [ "$strict" = "true" ]; then
      python3 "$script_path" --repo-root "$REPO_ROOT" --strict
    else
      python3 "$script_path" --repo-root "$REPO_ROOT"
    fi
    return
  fi

  if command -v python >/dev/null 2>&1; then
    if [ "$strict" = "true" ]; then
      python "$script_path" --repo-root "$REPO_ROOT" --strict
    else
      python "$script_path" --repo-root "$REPO_ROOT"
    fi
    return
  fi

  echo "[ops] ERROR: python/python3 not found for check-live-freshness" >&2
  exit 1
}

continuity_snapshot() {
  local output_path="${1:-}"
  local memory_dir="$REPO_ROOT/data/agent-memory"

  if [ ! -d "$memory_dir" ]; then
    echo "[ops] ERROR: memory dir missing: $memory_dir" >&2
    exit 1
  fi

  local py_bin=""
  if command -v python3 >/dev/null 2>&1; then
    py_bin="python3"
  elif command -v python >/dev/null 2>&1; then
    py_bin="python"
  else
    echo "[ops] ERROR: python/python3 not found for continuity-snapshot" >&2
    exit 1
  fi

  local payload
  payload="$($py_bin - "$memory_dir" <<'PY'
import glob
import hashlib
import json
import os
import sys

memory_dir = sys.argv[1]
files = sorted(glob.glob(os.path.join(memory_dir, '*.json')))
rows = []

for fp in files:
    try:
        st = os.stat(fp)
        with open(fp, 'rb') as f:
            content = f.read()
        rows.append({
            'file': os.path.basename(fp),
            'size_bytes': st.st_size,
            'mtime_epoch': st.st_mtime,
            'sha256': hashlib.sha256(content).hexdigest(),
        })
    except Exception as exc:  # pragma: no cover
        rows.append({
            'file': os.path.basename(fp),
            'error': str(exc),
        })

print(json.dumps({
    'ts_ms': int(__import__('time').time() * 1000),
    'memory_dir': memory_dir,
    'count': len(rows),
    'files': rows,
}, ensure_ascii=False))
PY
)"

  if [ -n "$output_path" ]; then
    mkdir -p "$(dirname "$output_path")"
    printf '%s\n' "$payload" > "$output_path"
    echo "[ops] continuity snapshot written: $output_path"
  fi

  printf '%s\n' "$payload" | json_pretty
}

health_restart_probe() {
  local health_json=""
  local health_ok=false
  if health_json="$(curl_get "/health" 2>/dev/null)"; then
    health_ok=true
  fi

  local api_port=""
  if command -v python3 >/dev/null 2>&1; then
    api_port="$(python3 - "$API_BASE" <<'PY'
import sys
from urllib.parse import urlparse
u = urlparse(sys.argv[1])
print(u.port or (443 if u.scheme == 'https' else 80))
PY
)"
  elif command -v python >/dev/null 2>&1; then
    api_port="$(python - "$API_BASE" <<'PY'
import sys
from urllib.parse import urlparse
u = urlparse(sys.argv[1])
print(u.port or (443 if u.scheme == 'https' else 80))
PY
)"
  else
    api_port="8080"
  fi

  local listener_count="-1"
  if command -v lsof >/dev/null 2>&1; then
    listener_count="$(lsof -iTCP:"$api_port" -sTCP:LISTEN -t 2>/dev/null | sort -u | wc -l | tr -d ' ')"
  elif command -v ss >/dev/null 2>&1; then
    listener_count="$(ss -ltn "sport = :$api_port" 2>/dev/null | awk 'NR>1 {count+=1} END {print count+0}')"
  fi

  local node_count="$(pgrep -fa "node server.mjs" | wc -l | tr -d ' ')"

  if [ "$health_ok" = true ]; then
    printf '{"health_ok":true,"api_base":"%s","api_port":%s,"listener_count":%s,"node_server_count":%s,"health":%s}\n' \
      "$API_BASE" "$api_port" "$listener_count" "$node_count" "$health_json" | json_pretty
  else
    printf '{"health_ok":false,"api_base":"%s","api_port":%s,"listener_count":%s,"node_server_count":%s}\n' \
      "$API_BASE" "$api_port" "$listener_count" "$node_count" | json_pretty
    return 1
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
  local symbols_csv="${1:-002131,300058,002342,600519,300059,600089,600986,601899,002050,002195}"
  local canonical_path="${ONLYTRADE_AKSHARE_CANONICAL:-data/live/onlytrade/frames.1m.json}"

  if [ -x "$AKSHARE_PYTHON" ]; then
    "$AKSHARE_PYTHON" "$REPO_ROOT/scripts/akshare/run_cycle.py" --symbols "$symbols_csv" --canonical-path "$canonical_path"
    return
  fi

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

overview_status() {
  echo "[ops] runtime overview status"
  curl_get "/api/agent/runtime/status" | json_pretty
}

market_overview_us_run_once() {
  node "$REPO_ROOT/scripts/alpaca_us/run_market_overview_cycle.mjs" --canonical-path "data/live/onlytrade/market_overview.us.json"
}

market_overview_us_if_open() {
  node "$REPO_ROOT/scripts/alpaca_us/run_market_overview_if_market_open.mjs" --canonical-path "data/live/onlytrade/market_overview.us.json"
}

market_overview_cn_run_once() {
  if [ -x "$AKSHARE_PYTHON" ]; then
    "$AKSHARE_PYTHON" "$REPO_ROOT/scripts/akshare/run_market_overview_cycle.py" --canonical-path "data/live/onlytrade/market_overview.cn-a.json"
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 "$REPO_ROOT/scripts/akshare/run_market_overview_cycle.py" --canonical-path "data/live/onlytrade/market_overview.cn-a.json"
    return
  fi
  python "$REPO_ROOT/scripts/akshare/run_market_overview_cycle.py" --canonical-path "data/live/onlytrade/market_overview.cn-a.json"
}

market_overview_cn_if_open() {
  if [ -x "$AKSHARE_PYTHON" ]; then
    "$AKSHARE_PYTHON" "$REPO_ROOT/scripts/akshare/run_market_overview_if_market_open.py" --canonical-path "data/live/onlytrade/market_overview.cn-a.json"
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 "$REPO_ROOT/scripts/akshare/run_market_overview_if_market_open.py" --canonical-path "data/live/onlytrade/market_overview.cn-a.json"
    return
  fi
  python "$REPO_ROOT/scripts/akshare/run_market_overview_if_market_open.py" --canonical-path "data/live/onlytrade/market_overview.cn-a.json"
}

news_digest_us_run_once() {
  node "$REPO_ROOT/scripts/alpaca_us/run_news_digest_cycle.mjs" --canonical-path "data/live/onlytrade/news_digest.us.json"
}

news_digest_cn_run_once() {
  if [ -x "$AKSHARE_PYTHON" ]; then
    "$AKSHARE_PYTHON" "$REPO_ROOT/scripts/akshare/run_news_digest_cycle.py" --canonical-path "data/live/onlytrade/news_digest.cn-a.json" --limit-total 36 --limit-per-symbol 10 --hot-limit-per-category 8 --hot-limit-total 36
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 "$REPO_ROOT/scripts/akshare/run_news_digest_cycle.py" --canonical-path "data/live/onlytrade/news_digest.cn-a.json" --limit-total 36 --limit-per-symbol 10 --hot-limit-per-category 8 --hot-limit-total 36
    return
  fi
  python "$REPO_ROOT/scripts/akshare/run_news_digest_cycle.py" --canonical-path "data/live/onlytrade/news_digest.cn-a.json" --limit-total 36 --limit-per-symbol 10 --hot-limit-per-category 8 --hot-limit-total 36
}

red_blue_cn_run_once() {
  if [ -x "$AKSHARE_PYTHON" ]; then
    "$AKSHARE_PYTHON" "$REPO_ROOT/scripts/akshare/run_red_blue_cycle.py" --canonical-path "data/live/onlytrade/market_breadth.cn-a.json"
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 "$REPO_ROOT/scripts/akshare/run_red_blue_cycle.py" --canonical-path "data/live/onlytrade/market_breadth.cn-a.json"
    return
  fi
  python "$REPO_ROOT/scripts/akshare/run_red_blue_cycle.py" --canonical-path "data/live/onlytrade/market_breadth.cn-a.json"
}

red_blue_cn_if_open() {
  if [ -x "$AKSHARE_PYTHON" ]; then
    "$AKSHARE_PYTHON" "$REPO_ROOT/scripts/akshare/run_red_blue_if_market_open.py" --canonical-path "data/live/onlytrade/market_breadth.cn-a.json"
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 "$REPO_ROOT/scripts/akshare/run_red_blue_if_market_open.py" --canonical-path "data/live/onlytrade/market_breadth.cn-a.json"
    return
  fi
  python "$REPO_ROOT/scripts/akshare/run_red_blue_if_market_open.py" --canonical-path "data/live/onlytrade/market_breadth.cn-a.json"
}

red_blue_replay_build() {
  local frames_path="${1:-onlytrade-web/public/replay/cn-a/latest/frames.1m.json}"
  local output_path="${2:-onlytrade-web/public/replay/cn-a/latest/market_breadth.1m.json}"
  local day_key="${3:-}"
  if command -v python3 >/dev/null 2>&1; then
    if [ -n "$day_key" ]; then
      python3 "$REPO_ROOT/scripts/replay/build_market_breadth_replay.py" --frames-path "$frames_path" --output-path "$output_path" --day-key "$day_key"
    else
      python3 "$REPO_ROOT/scripts/replay/build_market_breadth_replay.py" --frames-path "$frames_path" --output-path "$output_path"
    fi
    return
  fi
  if [ -n "$day_key" ]; then
    python "$REPO_ROOT/scripts/replay/build_market_breadth_replay.py" --frames-path "$frames_path" --output-path "$output_path" --day-key "$day_key"
  else
    python "$REPO_ROOT/scripts/replay/build_market_breadth_replay.py" --frames-path "$frames_path" --output-path "$output_path"
  fi
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
    factory_reset warmup 0 false | json_pretty
  else
    factory_reset cursor 0 false | json_pretty
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
      local dry_run="false"
      local confirmed="false"
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
          --dry-run)
            dry_run="true"
            shift
            ;;
          --confirm)
            confirmed="true"
            shift
            ;;
          *)
            echo "[ops] ERROR: unknown factory-reset option $1" >&2
            exit 1
            ;;
        esac
      done
      if [ "$confirmed" != "true" ]; then
        echo "[ops] ERROR: factory-reset requires --confirm" >&2
        exit 1
      fi
      factory_reset "$mode" "$cursor" "$dry_run" | json_pretty
      ;;
    agent-reset)
      local agent_id="${1:-}"
      shift || true
      if [ -z "$agent_id" ]; then
        echo "[ops] ERROR: agent-reset requires <agent_id>" >&2
        exit 1
      fi
      local reset_memory="false"
      local reset_positions="false"
      local reset_stats="false"
      local dry_run="false"
      local confirmed="false"
      while [ "$#" -gt 0 ]; do
        case "$1" in
          --full)
            reset_memory="true"
            reset_positions="true"
            reset_stats="true"
            shift
            ;;
          --positions-only)
            reset_memory="false"
            reset_positions="true"
            reset_stats="false"
            shift
            ;;
          --dry-run)
            dry_run="true"
            shift
            ;;
          --confirm)
            confirmed="true"
            shift
            ;;
          *)
            echo "[ops] ERROR: unknown agent-reset option $1" >&2
            exit 1
            ;;
        esac
      done
      if [ "$confirmed" != "true" ]; then
        echo "[ops] ERROR: agent-reset requires --confirm" >&2
        exit 1
      fi
      if [ "$reset_memory" != "true" ] && [ "$reset_positions" != "true" ] && [ "$reset_stats" != "true" ]; then
        echo "[ops] ERROR: agent-reset requires --full or --positions-only" >&2
        exit 1
      fi
      agent_reset "$agent_id" "$reset_memory" "$reset_positions" "$reset_stats" "$dry_run" | json_pretty
      ;;
    live-preflight)
      live_preflight | json_pretty
      ;;
    check-live-freshness)
      local strict="false"
      while [ "$#" -gt 0 ]; do
        case "$1" in
          --strict)
            strict="true"
            shift
            ;;
          *)
            echo "[ops] ERROR: unknown check-live-freshness option $1" >&2
            exit 1
            ;;
        esac
      done
      check_live_freshness "$strict" | json_pretty
      ;;
    continuity-snapshot)
      local output_path="${1:-}"
      continuity_snapshot "$output_path"
      ;;
    health-restart-probe)
      health_restart_probe
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
      local symbols_csv="002131,300058,002342,600519,300059,600089,600986,601899,002050,002195"
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
    market-overview-us-run-once)
      market_overview_us_run_once
      ;;
    market-overview-us-if-open)
      market_overview_us_if_open
      ;;
    market-overview-cn-run-once)
      market_overview_cn_run_once
      ;;
    market-overview-cn-if-open)
      market_overview_cn_if_open
      ;;
    news-digest-us-run-once)
      news_digest_us_run_once
      ;;
    news-digest-cn-run-once)
      news_digest_cn_run_once
      ;;
    red-blue-cn-run-once)
      red_blue_cn_run_once
      ;;
    red-blue-cn-if-open)
      red_blue_cn_if_open
      ;;
    red-blue-replay-build)
      local frames_path=""
      local output_path=""
      local day_key=""
      while [ "$#" -gt 0 ]; do
        case "$1" in
          --frames-path)
            frames_path="$2"
            shift 2
            ;;
          --output-path)
            output_path="$2"
            shift 2
            ;;
          --day-key)
            day_key="$2"
            shift 2
            ;;
          *)
            echo "[ops] ERROR: unknown red-blue-replay-build option $1" >&2
            exit 1
            ;;
        esac
      done
      red_blue_replay_build "$frames_path" "$output_path" "$day_key"
      ;;
    overview-status)
      overview_status
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
