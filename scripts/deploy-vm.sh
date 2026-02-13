#!/usr/bin/env bash
set -euo pipefail

BRANCH="${ONLYTRADE_BRANCH:-main}"
RUN_TESTS="${ONLYTRADE_RUN_TESTS:-1}"
RUN_BUILD="${ONLYTRADE_RUN_BUILD:-1}"
SETUP_PYTHON_VENV="${ONLYTRADE_SETUP_PYTHON_VENV:-0}"
VENV_PATH="${ONLYTRADE_VENV_PATH:-.venv}"
REQUIREMENTS_PATH="${ONLYTRADE_REQUIREMENTS_PATH:-requirements.txt}"

PM2_API_NAME="${ONLYTRADE_PM2_API_NAME:-onlytrade-runtime-api}"
PM2_WEB_NAME="${ONLYTRADE_PM2_WEB_NAME:-onlytrade-web}"
SYSTEMD_API_SERVICE="${ONLYTRADE_SYSTEMD_API_SERVICE:-}"
SYSTEMD_WEB_SERVICE="${ONLYTRADE_SYSTEMD_WEB_SERVICE:-}"

API_HEALTH_URL="${ONLYTRADE_API_HEALTH_URL:-http://127.0.0.1:8080/health}"
API_RUNTIME_URL="${ONLYTRADE_API_RUNTIME_URL:-http://127.0.0.1:8080/api/agent/runtime/status}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --branch)
      BRANCH="$2"
      shift 2
      ;;
    --skip-tests)
      RUN_TESTS="0"
      shift
      ;;
    --skip-build)
      RUN_BUILD="0"
      shift
      ;;
    --python-venv)
      SETUP_PYTHON_VENV="1"
      shift
      ;;
    --venv-path)
      VENV_PATH="$2"
      shift 2
      ;;
    --requirements)
      REQUIREMENTS_PATH="$2"
      shift 2
      ;;
    --help)
      cat <<'EOF'
Usage: ./scripts/deploy-vm.sh [options]

Options:
  --branch <name>         Deploy branch (default: main)
  --skip-tests            Skip npm test commands
  --skip-build            Skip frontend build
  --python-venv           Create/update Python virtual env
  --venv-path <path>      Virtual env path (default: .venv)
  --requirements <path>   requirements file (default: requirements.txt)

Environment overrides:
  ONLYTRADE_PM2_API_NAME, ONLYTRADE_PM2_WEB_NAME
  ONLYTRADE_SYSTEMD_API_SERVICE, ONLYTRADE_SYSTEMD_WEB_SERVICE
  ONLYTRADE_API_HEALTH_URL, ONLYTRADE_API_RUNTIME_URL
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[deploy] ERROR: run this script inside git repo" >&2
  exit 1
fi

echo "[deploy] Deploying branch: $BRANCH"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

BACKEND_DIR="runtime-api"
if [ ! -d "$BACKEND_DIR" ]; then
  BACKEND_DIR="mock-api"
fi

echo "[deploy] Installing backend deps"
npm ci --prefix "$BACKEND_DIR"

echo "[deploy] Installing frontend deps"
npm ci --prefix onlytrade-web

if [ "$RUN_TESTS" = "1" ]; then
  echo "[deploy] Running backend tests"
  npm test --prefix "$BACKEND_DIR"

  echo "[deploy] Running frontend tests"
  npm run test --prefix onlytrade-web -- --run
fi

if [ "$RUN_BUILD" = "1" ]; then
  echo "[deploy] Building frontend"
  npm run build --prefix onlytrade-web
fi

if [ "$SETUP_PYTHON_VENV" = "1" ]; then
  echo "[deploy] Setting up Python virtualenv"
  ./scripts/setup-python-venv.sh "$VENV_PATH" "$REQUIREMENTS_PATH"
fi

if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe "$PM2_API_NAME" >/dev/null 2>&1; then
    echo "[deploy] Restarting PM2 process: $PM2_API_NAME"
    pm2 restart "$PM2_API_NAME"
  fi
  if pm2 describe "$PM2_WEB_NAME" >/dev/null 2>&1; then
    echo "[deploy] Restarting PM2 process: $PM2_WEB_NAME"
    pm2 restart "$PM2_WEB_NAME"
  fi
fi

if [ -n "$SYSTEMD_API_SERVICE" ]; then
  echo "[deploy] Restarting systemd service: $SYSTEMD_API_SERVICE"
  sudo systemctl restart "$SYSTEMD_API_SERVICE"
fi

if [ -n "$SYSTEMD_WEB_SERVICE" ]; then
  echo "[deploy] Restarting systemd service: $SYSTEMD_WEB_SERVICE"
  sudo systemctl restart "$SYSTEMD_WEB_SERVICE"
fi

if command -v curl >/dev/null 2>&1; then
  echo "[deploy] Checking API health: $API_HEALTH_URL"
  curl -fsS "$API_HEALTH_URL" >/dev/null
  echo "[deploy] Checking API runtime status: $API_RUNTIME_URL"
  curl -fsS "$API_RUNTIME_URL" >/dev/null
fi

echo "[deploy] Done"
