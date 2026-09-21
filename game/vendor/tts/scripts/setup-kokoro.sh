#!/usr/bin/env bash
set -euo pipefail

TTS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$TTS_ROOT/.runtime/kokoro-venv"
VENV_MARKER="$VENV/.grey-crow-zh-only-v1"
UV_BIN="${UV_BIN:-$(command -v uv || true)}"
export HF_HOME="${HF_HOME:-$TTS_ROOT/.runtime/huggingface}"

if [[ -z "$UV_BIN" ]]; then
  echo "uv is required. Install it from https://docs.astral.sh/uv/" >&2
  exit 1
fi

mkdir -p "$TTS_ROOT/.runtime" "$HF_HOME"

if [[ ! -f "$VENV_MARKER" ]]; then
  rm -rf "$VENV"
  "$UV_BIN" venv --python 3.12 "$VENV"
fi

"$UV_BIN" pip install --python "$VENV/bin/python" --no-deps 'kokoro==0.9.4'
"$UV_BIN" pip install --python "$VENV/bin/python" \
  'misaki[zh]==0.9.4' \
  'attrs>=25,<27' \
  'huggingface-hub>=0.27,<2' \
  'loguru>=0.7,<1' \
  'numpy>=2,<3' \
  'torch>=2,<3' \
  'transformers>=4,<6' \
  'soundfile>=0.12,<1' \
  'socksio>=1,<2'

"$VENV/bin/python" "$TTS_ROOT/scripts/patch-kokoro-zh-only.py"

if "$VENV/bin/python" -c 'import importlib.util,sys; sys.exit(0 if importlib.util.find_spec("espeakng_loader") else 1)'; then
  echo "Refusing Kokoro environment: espeakng_loader must not be bundled in the zh-only runtime" >&2
  exit 1
fi

touch "$VENV_MARKER"

echo "Kokoro environment ready: $VENV"
