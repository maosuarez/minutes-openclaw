# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

## Project Overview

**minutes-openclaw** is an OpenClaw plugin that registers the [Minutes](../minutes/) CLI as a local `MediaUnderstandingProvider`, giving any OpenClaw channel offline whisper.cpp audio transcription without cloud API calls.

This repo is a thin TypeScript adapter — all transcription logic lives in the `minutes` binary from the parent project. See `../minutes/CLAUDE.md` for the full CLI architecture.

## Commands

```bash
npm install          # Install deps
npm run build        # tsc → dist/
npm test             # vitest run (unit tests, no disk/network)

# Live integration test (requires minutes binary in PATH)
MINUTES_OPENCLAW_LIVE=1 npm test
# Or with a custom binary:
MINUTES_BIN=/path/to/minutes MINUTES_OPENCLAW_LIVE=1 npm test
```

## Architecture

```
index.ts                        Plugin entry — registers the provider with OpenClaw
src/
  provider.ts                   MediaUnderstandingProvider contract + createMinutesProvider factory
  minutes-backend.ts            Core bridge: writes temp file → spawns minutes CLI → parses output
  transcript.ts                 Parses ## Transcript section and model field from minutes .md output
test/
  provider.test.ts              Contract tests (id, capabilities, auth, priority, transcribeAudio)
  minutes-backend.test.ts       Full coverage of CLI args, extension detection, JSON parsing, persistMemo
```

### Data flow

`OpenClaw audio request` → `provider.ts:transcribeAudio` → `minutes-backend.ts:runMinutes`:
1. Buffer written to temp file (extension from `fileName` or MIME)
2. `minutes process <temp> -t memo [-l <lang>]` spawned
3. JSON stdout parsed for `{ status: "done", file: "<memo.md>" }`
4. `## Transcript` section extracted from the .md via `transcript.ts`
5. YAML frontmatter `model:` field read and returned
6. Temp file always deleted; memo deleted only when `persistMemo: false`

### Priority

`autoPriority: { audio: 10 }` — lower beats bundled cloud providers (openai=20, xai=25, openrouter=35, google/senseaudio=40, mistral=50). Minutes is tried first when installed.

### Testability pattern

`MinutesBackendDeps` in `minutes-backend.ts` injects all I/O (`exec`, `writeTemp`, `readFile`, `unlink`). Unit tests use `makeDeps()` helpers that never touch disk or spawn processes. The live test at the bottom of `minutes-backend.test.ts` is the only test that calls the real binary, and it's gated by `MINUTES_OPENCLAW_LIVE=1`.

## OpenClaw plugin contract

- `openclaw.plugin.json` declares `contracts.mediaUnderstandingProviders: ["minutes"]` and the config schema (`persistMemo`, `minutesBin`, `language`).
- The plugin uses `definePluginEntry` from `openclaw/plugin-sdk/plugin-entry` (peer dep, `devDependencies` only).
- `resolveAuth` returns `{ kind: "none" }` — no API key is needed.
- `defaultModels: { audio: "whisper.cpp" }` is required by OpenClaw's provider resolution.

## Config exposed to OpenClaw users

| Key | Default | Description |
|---|---|---|
| `persistMemo` | `true` | Save the .md memo to `~/meetings/memos/` |
| `minutesBin` | `"minutes"` (or `$MINUTES_BIN`) | Path to the `minutes` binary |
| `language` | — | Default language code; per-request language takes precedence |
