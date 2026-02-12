#!/usr/bin/env bash
set -euo pipefail

VENV_PATH="${1:-.venv}"
REQUIREMENTS_PATH="${2:-requirements.txt}"

if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="python"
else
  echo "[venv] ERROR: python3/python not found in PATH" >&2
  exit 1
fi

echo "[venv] Using interpreter: $PYTHON_BIN"

if [ ! -d "$VENV_PATH" ]; then
  echo "[venv] Creating virtualenv at $VENV_PATH"
  "$PYTHON_BIN" -m venv "$VENV_PATH"
else
  echo "[venv] Reusing existing virtualenv at $VENV_PATH"
fi

"$VENV_PATH/bin/python" -m pip install --upgrade pip setuptools wheel

if [ -f "$REQUIREMENTS_PATH" ]; then
  echo "[venv] Installing requirements from $REQUIREMENTS_PATH"
  "$VENV_PATH/bin/pip" install -r "$REQUIREMENTS_PATH"
else
  echo "[venv] No $REQUIREMENTS_PATH found, skipping dependency install"
fi

echo "[venv] Ready. Activate with: source $VENV_PATH/bin/activate"
