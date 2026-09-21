#!/bin/bash
set -euo pipefail
GAME_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$GAME_DIR/apps/desktop/electron"

print_usage() {
  cat <<'USAGE'
Grey Crow desktop launcher

Usage:
  ./start.sh              Start the Grey Crow desktop app.
  ./start.sh play         Start the Grey Crow desktop app.
  ./start.sh bridge       Check the native session desktop bridge.
  ./start.sh check        Check native sessions and desktop source boundaries.
  ./start.sh ui-smoke     Run the synthetic Electron desktop checks.

Double-click on macOS: Grey Crow.command
Double-click on Windows: Grey Crow.bat
USAGE
}

ensure_desktop_ready() {
  if [ ! -f "$DESKTOP_DIR/package.json" ]; then
    echo "[FAIL] Desktop package.json is missing." >&2
    exit 64
  fi
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "[FAIL] Node.js and npm must be available on PATH." >&2
    exit 69
  fi
  if [ ! -d "$DESKTOP_DIR/node_modules/electron" ]; then
    echo "[FAIL] Desktop dependencies are missing." >&2
    exit 69
  fi
}

case "${1:-play}" in
  -h|--help|help)
    print_usage
    ;;
  play|app|desktop|game)
    ensure_desktop_ready
    cd "$DESKTOP_DIR"
    exec npm start
    ;;
  bridge)
    ensure_desktop_ready
    cd "$GAME_DIR"
    exec node --test engine/bridge/session-desktop-bridge.test.js
    ;;
  check)
    ensure_desktop_ready
    cd "$DESKTOP_DIR"
    npm run check:session
    node scripts/check-static.js
    exec npm run check:packaging-source
    ;;
  ui-smoke)
    ensure_desktop_ready
    cd "$DESKTOP_DIR"
    exec npm run smoke:ui
    ;;
  *)
    print_usage >&2
    exit 64
    ;;
esac
