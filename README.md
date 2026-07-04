# minutes-openclaw

Local whisper.cpp audio transcription for OpenClaw, powered by the [Minutes](https://github.com/silverstein/minutes) CLI.

Registers Minutes as a `MediaUnderstandingProvider` so **any OpenClaw channel** (WhatsApp, Telegram, etc.) gets private offline transcription without sending audio to a cloud API.

---

## Installation

Follow these steps in order.

### Prerequisites

Before installing this plugin, you need:

1. **`minutes` binary** (v0.19.0+ with `minutes transcribe --json` support)
   - Check: `minutes --help` should list a `transcribe` subcommand
   - If not found, install: `cargo install minutes-cli` or download from [github.com/silverstein/minutes/releases](https://github.com/silverstein/minutes/releases)
   - Supported as `minutes` in PATH, or via `MINUTES_BIN` environment variable
   - See [silverstein/minutes#380](https://github.com/silverstein/minutes/pull/380) for the contract

2. **Whisper model downloaded**
   - Run: `minutes setup --model small`
   - Other models available: `large`, `medium`, `tiny` (smaller = faster, lower accuracy)

3. **ffmpeg** (optional but recommended for WhatsApp/Telegram audio)
   - macOS: `brew install ffmpeg`
   - Linux: `apt install ffmpeg`
   - Without it, WAV and MP3 still work natively; ogg/opus/webm require ffmpeg

### Install the plugin

**Option A — From GitHub (recommended, one-liner):**

```bash
openclaw plugins install github:maosuarez/minutes-openclaw
curl -fsSL https://raw.githubusercontent.com/maosuarez/minutes-openclaw/master/install.sh | bash
```

With custom binary or language:

```bash
MINUTES_BIN=/usr/local/bin/minutes MINUTES_LANGUAGE=es \
  curl -fsSL https://raw.githubusercontent.com/maosuarez/minutes-openclaw/master/install.sh | bash
```

**Option B — From a local clone** (for development or offline):

```bash
git clone https://github.com/maosuarez/minutes-openclaw
cd minutes-openclaw
openclaw plugins install .
./install.sh
```

The `install.sh` script will:
- Enable audio transcription in `tools.media.audio.models`
- Apply plugin config (custom binary path, language)
- Run `openclaw plugins doctor` to verify setup

Environment variables for `install.sh`:

| Variable | Default | Description |
|---|---|---|
| `MINUTES_BIN` | `minutes` | Path to the `minutes` binary |
| `MINUTES_LANGUAGE` | _(auto-detect)_ | Default language code (`en`, `es`, `fr`, …) |

### Verify the installation

After running `install.sh`, restart the OpenClaw gateway so the config change applies, e.g.:

```bash
systemctl --user restart openclaw-gateway
```

Test end-to-end transcription:

```bash
openclaw infer audio transcribe --file /path/to/audio.wav --json
```

This routes through the minutes provider and prints the transcript. If it fails, check:
- `openclaw config view` confirms `tools.media.audio.models` contains `{ type: "provider", provider: "minutes" }`
- `minutes --version` confirms binary is in PATH or at `MINUTES_BIN`
- `openclaw plugins doctor` for plugin errors

## How it works

When OpenClaw receives a voice note attachment:

1. The audio buffer is written to a temp file.
2. `minutes transcribe <temp> --json [-l language]` is called locally — whisper.cpp
   transcribes it and prints a JSON envelope to stdout. No meeting files are written
   and no summarization runs.
3. `data.text` from the envelope is returned to OpenClaw for delivery.
4. The temp audio file is always deleted.

Nothing is persisted to disk beyond the temp audio file, which is removed as soon as
transcription finishes (or fails).

## Priority

`autoPriority: { audio: 10 }` — lower than all bundled cloud providers (openai=20, xai=25, …), so Minutes is tried **first** when installed.

## Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `minutesBin` | string | `"minutes"` | Path to the `minutes` binary (or set `MINUTES_BIN` env var) |
| `language` | string | _(auto)_ | Default language code (`"en"`, `"es"`, `"fr"`, …) |

## Development

```bash
npm install
npm run build   # tsc
npm test        # vitest unit tests (no disk/network)

# Live test (requires minutes binary + whisper model):
MINUTES_OPENCLAW_LIVE=1 npm test   # transcribes test/fixtures/demo.wav
```

## Design: self-contained community plugin

This is a community-owned package, independent of the Minutes core release train
(per the maintainer's guidance on coupling — OpenClaw ships ~monthly with an
evolving `pluginApi`, so the plugin tracks OpenClaw on its own cadence):
- Version `0.2.0`, independent of the Minutes workspace version.
- No source imports from Minutes crates — the sole runtime dependency is the
  `minutes` binary, invoked via subprocess.
- Pinned to OpenClaw's `pluginApi` / `pluginSdkVersion` in `package.json`.
- Shells out to the stable `minutes transcribe --json` contract
  ([silverstein/minutes#376](https://github.com/silverstein/minutes/issues/376),
  shipped in [#380](https://github.com/silverstein/minutes/pull/380)) instead of
  scraping a generated markdown memo. No meeting files are written by this plugin
  — earlier versions (`<0.2.0`) shelled out to `minutes process -t memo` and had a
  `persistMemo` option to keep that memo file; that option is gone since the new
  contract never creates one.
