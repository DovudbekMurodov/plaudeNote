#!/usr/bin/env bash
# PlaudeNote — bitta buyruq bilan ishga tushirish.
#   ./run.sh            dev rejim (hot reload)
#   ./run.sh --build    DMG yig'ish (src-tauri/target/release/bundle/dmg/)
set -euo pipefail
cd "$(dirname "$0")"

# Rust (rustup) PATH'da bo'lmasa ham ishlasin
[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"
command -v cargo >/dev/null || { echo "Rust yo'q: https://rustup.rs"; exit 1; }
command -v pnpm  >/dev/null || { echo "pnpm yo'q:  npm i -g pnpm"; exit 1; }
[ -d node_modules ] || pnpm install

# oldingi ishga tushirishdan qolgan jarayonlar
lsof -ti:1420 2>/dev/null | xargs kill 2>/dev/null || true
pkill -x plaudenote 2>/dev/null || true

if [ "${1:-}" = "--build" ]; then
  exec pnpm tauri build
fi
exec pnpm tauri dev
