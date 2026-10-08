# PlaudeNote

Local-first AI voice notes for macOS (Apple Silicon). Record or import audio, transcribe on-device
(Uzbek / Arabic / auto), and turn it into a structured note — summary, to-dos, mind map. No server,
no accounts, nothing leaves the Mac.

## Stack

Tauri 2 (Rust) · React 19 · TypeScript · Tailwind 4 · Tiptap 3 · ECharts · SQLite ·
whisper.cpp (`whisper-rs`) · llama.cpp (`llama-server` sidecar)

## Run

One command (installs deps on first run, cleans up leftovers, starts dev mode):

```bash
./run.sh
```

Build the DMG:

```bash
./run.sh --build
```

Equivalent npm scripts: `pnpm start`, `pnpm build:app`.

Prerequisites: Node 24+, pnpm, Rust (`rustup`), Xcode Command Line Tools.

`pnpm dev` alone serves the UI in a browser at http://localhost:1420 (no vibrancy, no native APIs).

## Build

```bash
pnpm tauri build
```

Produces `src-tauri/target/release/bundle/dmg/PlaudeNote_*.dmg`.

### Opening an unsigned build on another Mac

The DMG is not notarized. macOS will say the app "could not be verified". Either:

1. Open **System Settings → Privacy & Security**, scroll down, click **Open Anyway**, or
2. run in Terminal:

```bash
xattr -cr /Applications/PlaudeNote.app
```

AI models are not inside the DMG. On first launch the **Models** window downloads them into
`~/Library/Application Support/PlaudeNote/models/`.

## Layout

```
src/            React UI (app shell, features, ui primitives, i18n uz/ar/en)
src-tauri/      Rust core (db, audio, stt, llm, models, pipeline, LAN server)
```
