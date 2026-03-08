#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

VM_HOST="${T017_VM_HOST:-113.125.202.169}"
VM_PORT="${T017_VM_PORT:-21522}"
VM_USER="${T017_VM_USER:-root}"
VM_KEY="${T017_VM_KEY:-$HOME/.ssh/cn169_ed25519}"

LOCAL_WEB_DIR="${T017_LOCAL_WEB_DIR:-$REPO_ROOT/onlytrade-web}"
LOCAL_TARBALL="${T017_LOCAL_WEB_TARBALL:-$REPO_ROOT/onlytrade-web-dist-t017-uifix.tgz}"
REMOTE_ROOT="${T017_REMOTE_ROOT:-/opt/onlytrade}"
REMOTE_WEB_DIR="${T017_REMOTE_WEB_DIR:-$REMOTE_ROOT/onlytrade-web}"
REMOTE_TARBALL="$REMOTE_WEB_DIR/$(basename "$LOCAL_TARBALL")"
REMOTE_DIST_DIR="$REMOTE_WEB_DIR/dist"

rm -f "$LOCAL_TARBALL"
tar -czf "$LOCAL_TARBALL" -C "$LOCAL_WEB_DIR/dist" .

scp -P "$VM_PORT" -i "$VM_KEY" "$LOCAL_TARBALL" "$VM_USER@$VM_HOST:$REMOTE_TARBALL"

ssh -p "$VM_PORT" -i "$VM_KEY" "$VM_USER@$VM_HOST" <<EOF
set -euo pipefail
mkdir -p "$REMOTE_DIST_DIR"
tar -xzf "$REMOTE_TARBALL" -C "$REMOTE_DIST_DIR"
chmod -R a+rX "$REMOTE_DIST_DIR/assets" "$REMOTE_DIST_DIR/icons"
/usr/local/nginx/sbin/nginx -s reload
grep -o 'assets/index-[^"]*' "$REMOTE_DIST_DIR/index.html"
EOF
