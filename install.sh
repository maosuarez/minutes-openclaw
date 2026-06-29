#!/usr/bin/env bash
# Configure OpenClaw to use the minutes-openclaw plugin for audio transcription.
# Run this after: openclaw plugins install github:maosuarez/minutes-openclaw
#
# Env vars (all optional):
#   MINUTES_BIN          Path to the minutes binary (default: "minutes")
#   MINUTES_LANGUAGE     Default language code, e.g. "es", "en" (default: auto-detect)
#   MINUTES_PERSIST_MEMO Save .md memos in ~/meetings/memos/ — true|false (default: true)
#
# Example:
#   MINUTES_BIN=/usr/local/bin/minutes MINUTES_LANGUAGE=es ./install.sh

set -euo pipefail

MINUTES_BIN="${MINUTES_BIN:-minutes}"
MINUTES_LANGUAGE="${MINUTES_LANGUAGE:-}"
MINUTES_PERSIST_MEMO="${MINUTES_PERSIST_MEMO:-true}"

# ── Preflight checks ──────────────────────────────────────────────────────────

if ! command -v openclaw &>/dev/null; then
  echo "error: openclaw not found in PATH" >&2
  exit 1
fi

if ! command -v "$MINUTES_BIN" &>/dev/null; then
  echo "warning: '$MINUTES_BIN' not found in PATH — set MINUTES_BIN or install minutes first" >&2
  echo "  See: https://github.com/silverstein/minutes#installation" >&2
fi

# ── Wire audio routing ────────────────────────────────────────────────────────

echo "→ Configuring OpenClaw audio provider..."
openclaw config patch --stdin <<'EOF'
{
  tools: {
    media: {
      audio: {
        enabled: true,
        models: [{ type: "provider", provider: "minutes", model: "whisper.cpp" }]
      }
    }
  }
}
EOF

# ── Plugin settings ───────────────────────────────────────────────────────────

# Build the plugin config object only with non-default values
PLUGIN_PATCH=""

if [ "$MINUTES_BIN" != "minutes" ]; then
  PLUGIN_PATCH="minutesBin: \"$MINUTES_BIN\""
fi

if [ -n "$MINUTES_LANGUAGE" ]; then
  [ -n "$PLUGIN_PATCH" ] && PLUGIN_PATCH="$PLUGIN_PATCH, "
  PLUGIN_PATCH="${PLUGIN_PATCH}language: \"$MINUTES_LANGUAGE\""
fi

if [ "$MINUTES_PERSIST_MEMO" = "false" ]; then
  [ -n "$PLUGIN_PATCH" ] && PLUGIN_PATCH="$PLUGIN_PATCH, "
  PLUGIN_PATCH="${PLUGIN_PATCH}persistMemo: false"
fi

if [ -n "$PLUGIN_PATCH" ]; then
  echo "→ Applying plugin settings..."
  openclaw config patch --stdin <<EOF
{ plugins: { minutes: { $PLUGIN_PATCH } } }
EOF
fi

# ── Verify ────────────────────────────────────────────────────────────────────

echo "→ Verifying plugin..."
openclaw plugins doctor

echo ""
echo "✓ minutes-openclaw installed. Audio in OpenClaw will now transcribe locally via whisper.cpp."
echo ""
echo "  To test end-to-end:"
echo "    openclaw infer audio transcribe --file /path/to/audio.wav --json"
