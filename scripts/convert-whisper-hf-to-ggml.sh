#!/usr/bin/env bash
# Convert a HuggingFace whisper fine-tune to whisper.cpp ggml (f16 + q5_0).
#   scripts/convert-whisper-hf-to-ggml.sh Kotib/uzbek_stt_v1 uzbek-kotib-medium
# Needs: python3, cmake, git, ~8 GB free. Output: dist-models/ggml-<name>-q5_0.bin
set -euo pipefail
REPO="$1"; NAME="$2"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-$ROOT/.convert}"; mkdir -p "$WORK" "$ROOT/dist-models"

[ -d "$WORK/venv" ] || { python3 -m venv "$WORK/venv"; "$WORK/venv/bin/pip" -q install torch transformers numpy safetensors huggingface_hub; }
[ -d "$WORK/whisper.cpp" ] || git clone -q --depth 1 https://github.com/ggml-org/whisper.cpp.git "$WORK/whisper.cpp"
[ -d "$WORK/whisper-py" ] || git clone -q --depth 1 https://github.com/openai/whisper.git "$WORK/whisper-py"
[ -x "$WORK/whisper.cpp/build/bin/whisper-quantize" ] || (cd "$WORK/whisper.cpp" && cmake -S . -B build -DWHISPER_BUILD_TESTS=OFF -DCMAKE_BUILD_TYPE=Release >/dev/null && cmake --build build --config Release -j --target whisper-quantize >/dev/null)

HF="$WORK/hf/$(basename "$REPO")"; mkdir -p "$HF"
for f in config.json generation_config.json preprocessor_config.json tokenizer_config.json vocab.json merges.txt added_tokens.json special_tokens_map.json normalizer.json model.safetensors; do
  [ -f "$HF/$f" ] || curl -sL --fail -o "$HF/$f" "https://huggingface.co/$REPO/resolve/main/$f" || true
done

OUT="$WORK/out/$NAME"; mkdir -p "$OUT"
"$WORK/venv/bin/python" "$WORK/whisper.cpp/models/convert-h5-to-ggml.py" "$HF" "$WORK/whisper-py" "$OUT" >/dev/null
"$WORK/whisper.cpp/build/bin/whisper-quantize" "$OUT/ggml-model.bin" "$ROOT/dist-models/ggml-$NAME-q5_0.bin" q5_0 | tail -1
ls -la "$ROOT/dist-models/ggml-$NAME-q5_0.bin"
echo "size (for registry.rs): $(stat -f%z "$ROOT/dist-models/ggml-$NAME-q5_0.bin")"
