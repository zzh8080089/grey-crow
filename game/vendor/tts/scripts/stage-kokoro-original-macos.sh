#!/usr/bin/env bash
set -euo pipefail

TTS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$TTS_ROOT/.runtime/kokoro-venv"
HF_REPO="$TTS_ROOT/.runtime/huggingface/hub/models--hexgrad--Kokoro-82M-v1.1-zh"
SNAPSHOT_ID="01e7505bd6a7a2ac4975463114c3a7650a9f7218"
SNAPSHOT="$HF_REPO/snapshots/$SNAPSHOT_ID"
VOICE_LIBRARY="$TTS_ROOT/.runtime/kokoro-original/voice-library/voices"
MODEL_CARD="$TTS_ROOT/licenses/upstream/kokoro-model/README.md"
STAGE_ROOT="$TTS_ROOT/.runtime/kokoro-original/stage-macos-arm64-minimal"
PYTHON_BASE="$($VENV/bin/python -c 'import sys; print(sys.base_prefix)')"
CURATED_VOICES=(zf_001 zf_006 zm_009 zm_010)

if [[ "$(uname -s)" != "Darwin" ]] || [[ "$(uname -m)" != "arm64" ]]; then
  echo "This staging check is only for macOS arm64." >&2
  exit 1
fi

for required in config.json kokoro-v1_1-zh.pth; do
  if [[ ! -e "$SNAPSHOT/$required" ]]; then
    echo "Missing pinned Kokoro resource: $SNAPSHOT/$required" >&2
    exit 1
  fi
done
if [[ ! -f "$MODEL_CARD" ]]; then
  echo "Missing pinned Kokoro model card: $MODEL_CARD" >&2
  exit 1
fi
for voice_id in "${CURATED_VOICES[@]}"; do
  if [[ ! -f "$VOICE_LIBRARY/$voice_id.pt" ]]; then
    echo "Missing curated Kokoro voice: $VOICE_LIBRARY/$voice_id.pt" >&2
    exit 1
  fi
done

rm -rf "$STAGE_ROOT"
mkdir -p \
  "$STAGE_ROOT/models/kokoro-original" \
  "$STAGE_ROOT/outputs" \
  "$STAGE_ROOT/home"

"$VENV/bin/python" "$TTS_ROOT/scripts/build-kokoro-original-minimal-runtime.py" \
  --python-base "$PYTHON_BASE" \
  --site-packages "$VENV/lib/python3.12/site-packages" \
  --platform-label "macos-arm64" \
  --python-layout "unix" \
  --output "$STAGE_ROOT/python"
cp "$TTS_ROOT/licenses/upstream/cpython/LICENSE" "$STAGE_ROOT/python/LICENSE"

copy_runtime_license() {
  local distribution_glob="$1"
  local source_license="$2"
  local matches=("$STAGE_ROOT"/python/lib/python3.12/site-packages/$distribution_glob.dist-info)
  if [[ ${#matches[@]} -ne 1 ]] || [[ ! -d "${matches[0]}" ]]; then
    echo "Expected one staged distribution for $distribution_glob." >&2
    exit 1
  fi
  mkdir -p "${matches[0]}/licenses"
  cp "$source_license" "${matches[0]}/licenses/LICENSE"
}

copy_runtime_license "jieba-*" "$TTS_ROOT/licenses/upstream/jieba/LICENSE"
copy_runtime_license "loguru-*" "$TTS_ROOT/licenses/upstream/loguru/LICENSE"
copy_runtime_license "ordered_set-*" "$TTS_ROOT/licenses/upstream/ordered-set/LICENSE"
copy_runtime_license "tokenizers-*" "$TTS_ROOT/licenses/upstream/tokenizers/LICENSE"
cp -L "$SNAPSHOT/config.json" "$STAGE_ROOT/models/kokoro-original/config.json"
cp -L "$SNAPSHOT/kokoro-v1_1-zh.pth" "$STAGE_ROOT/models/kokoro-original/kokoro-v1_1-zh.pth"
cp "$VENV/lib/python3.12/site-packages/kokoro-0.9.4.dist-info/licenses/LICENSE" \
  "$STAGE_ROOT/models/kokoro-original/LICENSE"
cp "$MODEL_CARD" "$STAGE_ROOT/models/kokoro-original/README.md"
for voice_id in "${CURATED_VOICES[@]}"; do
  cp -L "$VOICE_LIBRARY/$voice_id.pt" "$STAGE_ROOT/models/kokoro-original/$voice_id.pt"
done
cp "$TTS_ROOT/scripts/kokoro-original-package-smoke.py" "$STAGE_ROOT/kokoro-original-package-smoke.py"

env -i \
  HOME="$STAGE_ROOT/home" \
  PATH="/usr/bin:/bin" \
  HTTPS_PROXY="http://127.0.0.1:1" \
  HTTP_PROXY="http://127.0.0.1:1" \
  NO_PROXY="" \
  HF_HUB_OFFLINE="1" \
  TRANSFORMERS_OFFLINE="1" \
  TOKENIZERS_PARALLELISM="false" \
  "$STAGE_ROOT/python/bin/python3.12" \
  "$STAGE_ROOT/kokoro-original-package-smoke.py" \
  --bundle-root "$STAGE_ROOT" \
  --text "这是灰鸦原版 Kokoro 中文语音包的离线封装测试。" \
  --output "$STAGE_ROOT/outputs/package-smoke.wav"

file "$STAGE_ROOT/outputs/package-smoke.wav"
rm "$STAGE_ROOT/kokoro-original-package-smoke.py" "$STAGE_ROOT/outputs/package-smoke.wav"
rmdir "$STAGE_ROOT/outputs"
"$STAGE_ROOT/python/bin/python3.12" \
  "$TTS_ROOT/scripts/generate-kokoro-original-compliance.py" \
  --stage-root "$STAGE_ROOT"
if find "$STAGE_ROOT" -iname '*soundfile*' -o -iname '*libsndfile*' -o -iname '*espeak*' | grep -q .; then
  echo "Forbidden TTS dependency survived minimal staging." >&2
  exit 1
fi
du -sh "$STAGE_ROOT"
echo "Self-contained original Kokoro staging ready: $STAGE_ROOT"
