#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${ONLYTRADE_REPO_ROOT:-/opt/onlytrade}"
PYTHON_BIN="${ONLYTRADE_TTS_GATEWAY_PYTHON:-python3}"
VENV_PATH="${ONLYTRADE_TTS_GATEWAY_VENV:-$REPO_ROOT/.venv-tts-gateway}"
SERVICE_NAME="${ONLYTRADE_TTS_GATEWAY_SERVICE:-onlytrade-tts-gateway}"
LISTEN_HOST="${TTS_GATEWAY_HOST:-127.0.0.1}"
LISTEN_PORT="${TTS_GATEWAY_PORT:-13003}"
LOCAL_TTS_URL="${TTS_GATEWAY_LOCAL_TTS_URL:-http://101.227.82.130:13002/tts}"
FALLBACK_VOICE="${TTS_GATEWAY_COSY_FALLBACK_LOCAL_VOICE:-zsy}"
LOG_PATH="${ONLYTRADE_TTS_GATEWAY_LOG:-/var/log/onlytrade/tts-gateway.log}"

if [ ! -d "$REPO_ROOT" ]; then
  echo "[tts-gateway] ERROR: repo not found: $REPO_ROOT" >&2
  exit 1
fi

cd "$REPO_ROOT"

if [ ! -f "$REPO_ROOT/runtime-api/.env.local" ]; then
  echo "[tts-gateway] ERROR: missing runtime-api/.env.local" >&2
  exit 1
fi

API_KEY="$(grep -E '^OPENAI_API_KEY=' "$REPO_ROOT/runtime-api/.env.local" | tail -n 1 | cut -d '=' -f2- | tr -d '"' | tr -d "'" )"
if [ -z "$API_KEY" ]; then
  echo "[tts-gateway] ERROR: OPENAI_API_KEY missing in runtime-api/.env.local" >&2
  exit 1
fi

mkdir -p "$(dirname "$LOG_PATH")"

if [ ! -x "$VENV_PATH/bin/python" ] || [ ! -x "$VENV_PATH/bin/pip" ]; then
  if "$PYTHON_BIN" -m venv "$VENV_PATH"; then
    :
  elif [ -x "$REPO_ROOT/.venv-akshare/bin/python" ]; then
    echo "[tts-gateway] WARN: failed to create venv with $PYTHON_BIN, fallback to $REPO_ROOT/.venv-akshare" >&2
    VENV_PATH="$REPO_ROOT/.venv-akshare"
  else
    echo "[tts-gateway] ERROR: could not create venv and no fallback venv found" >&2
    exit 1
  fi
fi

"$VENV_PATH/bin/pip" install --upgrade pip setuptools wheel
"$VENV_PATH/bin/pip" install -r "$REPO_ROOT/scripts/tts-gateway/requirements.txt"

sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null <<EOF
[Unit]
Description=OnlyTrade TTS Gateway
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$REPO_ROOT
Environment=PYTHONUNBUFFERED=1
Environment=DASHSCOPE_API_KEY=$API_KEY
Environment=TTS_GATEWAY_HOST=$LISTEN_HOST
Environment=TTS_GATEWAY_PORT=$LISTEN_PORT
Environment=TTS_GATEWAY_LOCAL_TTS_URL=$LOCAL_TTS_URL
Environment=TTS_GATEWAY_COSY_FALLBACK_LOCAL_VOICE=$FALLBACK_VOICE
ExecStart=$VENV_PATH/bin/python $REPO_ROOT/scripts/tts-gateway/gateway.py
Restart=always
RestartSec=2
StandardOutput=append:$LOG_PATH
StandardError=append:$LOG_PATH

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE_NAME"
sudo systemctl status "$SERVICE_NAME" --no-pager

echo "[tts-gateway] installed service=$SERVICE_NAME host=$LISTEN_HOST port=$LISTEN_PORT"
echo "[tts-gateway] health: curl -fsS http://$LISTEN_HOST:$LISTEN_PORT/health"
