# minutes-openclaw

Local whisper.cpp audio transcription for OpenClaw, powered by the [Minutes](https://github.com/silverstein/minutes) CLI.

Registers Minutes as a `MediaUnderstandingProvider` so **any OpenClaw channel** (WhatsApp, Telegram, etc.) gets private offline transcription without sending audio to a cloud API.

## Requirements

- **`minutes` binary in PATH** (or set `MINUTES_BIN=/path/to/minutes`) that includes the
  `minutes transcribe --json` command (added upstream in
  [silverstein/minutes#380](https://github.com/silverstein/minutes/pull/380), merged to
  `main` after `v0.19.0`). If `minutes --help` doesn't list a `transcribe` subcommand,
  build from source or wait for the next tagged release.
  - Install: `cargo install minutes-cli` or download from [github.com/silverstein/minutes/releases](https://github.com/silverstein/minutes/releases)
- **Whisper model downloaded**: `minutes setup --model small`
- **ffmpeg** (recommended for ogg/opus/webm from WhatsApp/Telegram):
  - macOS: `brew install ffmpeg`
  - Linux: `apt install ffmpeg`
  - Without ffmpeg, WAV and MP3 are still supported natively

## Installation

**One-liner** — installs and builds directly from GitHub, then configures OpenClaw:

```bash
openclaw plugins install github:maosuarez/minutes-openclaw
curl -fsSL https://raw.githubusercontent.com/maosuarez/minutes-openclaw/master/install.sh | bash
```

**Custom binary or language:**

```bash
MINUTES_BIN=/usr/local/bin/minutes MINUTES_LANGUAGE=es \
  curl -fsSL https://raw.githubusercontent.com/maosuarez/minutes-openclaw/master/install.sh | bash
```

**From a local clone** (for development or offline):

```bash
git clone https://github.com/maosuarez/minutes-openclaw
cd minutes-openclaw
openclaw plugins install .   # prepare script builds automatically
./install.sh
```

`install.sh` env vars:

| Var | Default | Description |
|---|---|---|
| `MINUTES_BIN` | `minutes` | Path to the `minutes` binary |
| `MINUTES_LANGUAGE` | _(auto)_ | Default language code (`en`, `es`, `fr`, …) |

## Enable for audio understanding

Installing the plugin registers the provider, but OpenClaw only uses it once you
wire it into `tools.media.audio.models` (same as any other audio provider —
installation alone is not enough). One validated write:

```bash
openclaw config patch --stdin <<'EOF'
{ tools: { media: { audio: { enabled: true, models: [ { type: "provider", provider: "minutes", model: "whisper.cpp" } ] } } } }
EOF
openclaw plugins doctor          # should report "No plugin issues detected"
# restart the gateway so the change applies (e.g. systemctl --user restart openclaw-gateway)
```

Verify end-to-end without sending a real voice note:

```bash
openclaw infer audio transcribe --file /path/to/audio.wav --json
# routes through the minutes provider and prints the transcript
```

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
