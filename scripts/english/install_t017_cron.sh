#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PYTHON_BIN="${T017_PYTHON_BIN:-$REPO_ROOT/.venv-akshare/bin/python}"
OUTPUT_JSON="${T017_OUTPUT_JSON:-$REPO_ROOT/data/live/onlytrade/english_classroom_live.json}"
IMAGE_DIR="${T017_IMAGE_DIR:-$REPO_ROOT/data/live/onlytrade/english_images/t_017}"
LOG_DIR="${T017_LOG_DIR:-/var/log/onlytrade}"
MATERIAL_PROVIDER="${T017_MATERIAL_PROVIDER:-auto}"
MATERIAL_MAX_ITEMS="${T017_MATERIAL_MAX_ITEMS:-8}"
MATERIAL_TIMEOUT_SEC="${T017_MATERIAL_TIMEOUT_SEC:-40}"
MATERIAL_CACHE="${T017_MATERIAL_CACHE:-$REPO_ROOT/data/live/onlytrade/english_classroom_material_cache.json}"

mkdir -p "$(dirname "$OUTPUT_JSON")" "$IMAGE_DIR" "$LOG_DIR" "$(dirname "$MATERIAL_CACHE")"

if [ ! -x "$PYTHON_BIN" ]; then
  echo "[t017-cron] ERROR: python not executable at $PYTHON_BIN" >&2
  exit 1
fi

TMP_FILE="$(mktemp)"
{
  crontab -l 2>/dev/null || true
} | awk '
  BEGIN { skip=0 }
  /# BEGIN ONLYTRADE_T017_ENGLISH_CRON/ { skip=1; next }
  /# END ONLYTRADE_T017_ENGLISH_CRON/ { skip=0; next }
  skip==0 { print }
' > "$TMP_FILE"

cat >> "$TMP_FILE" <<EOF
# BEGIN ONLYTRADE_T017_ENGLISH_CRON
*/5 * * * * timeout -k 5s 150s flock -n /tmp/onlytrade_t017_news.lock PYTHONPATH=$REPO_ROOT "$PYTHON_BIN" "$REPO_ROOT/scripts/english/run_google_news_cycle.py" --output "$OUTPUT_JSON" --image-dir "$IMAGE_DIR" --limit-total 24 --limit-per-category 10 --material-provider "$MATERIAL_PROVIDER" --material-max-items "$MATERIAL_MAX_ITEMS" --material-timeout-sec "$MATERIAL_TIMEOUT_SEC" --material-cache "$MATERIAL_CACHE" >> "$LOG_DIR/t017_news.log" 2>&1
17 3 * * * timeout -k 5s 60s flock -n /tmp/onlytrade_t017_news_gc.lock PYTHONPATH=$REPO_ROOT "$PYTHON_BIN" "$REPO_ROOT/scripts/english/prune_news_images.py" --image-dir "$IMAGE_DIR" --max-files 600 --max-age-hours 72 >> "$LOG_DIR/t017_news_gc.log" 2>&1
# END ONLYTRADE_T017_ENGLISH_CRON
EOF

crontab "$TMP_FILE"
rm -f "$TMP_FILE"

echo "[t017-cron] installed"
crontab -l | sed -n '/# BEGIN ONLYTRADE_T017_ENGLISH_CRON/,/# END ONLYTRADE_T017_ENGLISH_CRON/p'
