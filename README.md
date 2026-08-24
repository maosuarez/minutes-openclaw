# 🚀 Minutes for OpenClaw

**Transform voice notes into actionable text, privately and offline.**

The **Minutes OpenClaw Plugin** bridges the gap between your OpenClaw channels (WhatsApp, Telegram, etc.) and the powerful [Minutes](https://github.com/silverstein/minutes) local transcription engine. Enjoy lightning-fast, highly accurate audio transcriptions using `whisper.cpp`—all without sending a single byte of your audio data to the cloud.

---

## 🌟 Why Minutes for OpenClaw?

- **🔒 100% Privacy & Security:** Your audio never leaves your machine. Perfect for enterprise environments, sensitive conversations, and strict compliance requirements.
- **⚡ Offline First:** No internet? No problem. Transcribe anywhere, anytime, without relying on external API availability or dealing with latency.
- **💰 Zero Cloud Costs:** Say goodbye to per-minute API billing. Leverage your local hardware to transcribe unlimited audio for free.
- **🔌 Seamless Integration:** Plugs directly into any OpenClaw channel, instantly upgrading your workflow with robust voice-to-text capabilities.
- **🎯 High Accuracy:** Powered by the industry-leading Whisper models, tailored for maximum precision across multiple languages.

---

## 🛠️ Quick Installation

Get started in minutes. Ensure you have the `minutes` binary installed, then run:

**Install directly from GitHub:**
```bash
openclaw plugins install github:maosuarez/minutes-openclaw
curl -fsSL https://raw.githubusercontent.com/maosuarez/minutes-openclaw/master/install.sh | bash
```

For detailed prerequisites (like Whisper models and ffmpeg) and advanced configuration, see the [Technical Documentation](#technical-documentation) below.

---

## ⚙️ Technical Documentation

### Prerequisites

Before installing this plugin, ensure your environment is ready:

1. **`minutes` CLI** (v0.19.0+ required)
   - Ensure `minutes transcribe --json` is available.
   - Install via cargo: `cargo install minutes-cli` or download from [Releases](https://github.com/silverstein/minutes/releases).
2. **Whisper Model**
   - Download the model that fits your needs: `minutes setup --model small` (options: `tiny`, `small`, `medium`, `large`).
3. **ffmpeg** (Recommended for WhatsApp/Telegram formats)
   - macOS: `brew install ffmpeg` | Linux: `apt install ffmpeg`

### Configuration

Control your transcription experience via environment variables during installation or OpenClaw config:

| Key | Default | Description |
|-----|---------|-------------|
| `minutesBin` | `"minutes"` | Path to the `minutes` executable |
| `language` | _(auto)_ | Default language code (`"en"`, `"es"`, etc.) |

*Note: The plugin operates with high priority (`autoPriority: { audio: 10 }`), ensuring local transcription is preferred over slower cloud alternatives when available.*

### Architecture & Privacy Design

When OpenClaw receives a voice note:
1. The audio is temporarily cached.
2. `minutes transcribe` processes the audio locally via whisper.cpp.
3. The transcription text is delivered securely back to OpenClaw.
4. **All temporary audio files are instantly permanently deleted.** No audio is ever persisted, and no meeting summaries are generated, ensuring absolute privacy.

---

*For developers, see [AGENTS.md](./AGENTS.md) for development guidelines and architecture.*
