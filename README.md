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
pnpm tauri build --target aarch64-apple-darwin
```

Produces `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/PlaudeNote_<version>_aarch64.dmg`
plus the updater bundle `macos/PlaudeNote.app.tar.gz` + `.sig` (needs `TAURI_SIGNING_PRIVATE_KEY`,
see below). Apple Silicon only, macOS 13.3+.

### Install (first time)

Open the DMG → drag **PlaudeNote** to **Applications**. The DMG is not notarized, so on first launch
macOS says the app "could not be verified". Either:

1. **System Settings → Privacy & Security**, scroll down, click **Open Anyway**, or
2. run in Terminal:

```bash
xattr -cr /Applications/PlaudeNote.app
```

AI models are not inside the DMG. On first launch the **Models** window downloads them.

### Updates (automatic)

The app checks `https://github.com/DovudbekMurodov/plaudeNote/releases/latest/download/latest.json`
a few seconds after launch (and on demand: Settings → *Check for updates*). When a newer version
exists, a bar at the bottom offers **Update and restart**: the signed `.app.tar.gz` is downloaded,
verified against the public key in `tauri.conf.json`, swapped in place and the app relaunches.
Notes, recordings and models are untouched (see *Data*).

### Releasing a new version

1. Bump `version` in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` (keep them equal).
2. Commit, then tag and push:

```bash
git tag v0.3.0 && git push origin main v0.3.0
```

3. The `release` GitHub Action builds the DMG + updater bundle and publishes a GitHub Release with
   `latest.json`. Every installed app picks it up on its next launch.

The Action signs updates with the repository secret `TAURI_SIGNING_PRIVATE_KEY` (the private half of
the key pair whose public half is in `tauri.conf.json`; the original lives in `~/.tauri/plaudenote.key`).
**Losing that key means no installed app can ever update again** — back it up. A local build signs
the same way:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/plaudenote.key)"
```

### Data

Everything lives in `~/Library/Application Support/dev.plaudenote.app/`:

| | |
|---|---|
| `plaudenote.db` | SQLite: notes (Tiptap JSON), folders, transcripts, jobs — FTS5 index |
| `recordings/` | 16 kHz mono WAV per recording |
| `attachments/` | images dropped into notes |
| `models/` | whisper / llama models + the llama.cpp runtime |

Updates never touch this folder; schema changes run as migrations on startup. To move to another
Mac, copy the folder. Deleting the app does not delete the data.

## Layout

```
src/            React UI (app shell, features, ui primitives, i18n uz/ar/en)
src-tauri/      Rust core (db, audio, stt, llm, models, pipeline, LAN server)
```
