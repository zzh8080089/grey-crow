#!/bin/bash

GAME_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$GAME_DIR" || exit 1

./start.sh
STATUS=$?

if [ "$STATUS" -ne 0 ]; then
  echo
  echo "Grey Crow stopped with status $STATUS."
  read -r -p "Press Enter to close this window..."
fi

exit "$STATUS"
