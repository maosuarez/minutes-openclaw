# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**minutes-openclaw** is an OpenClaw plugin that registers the [Minutes](../minutes/) CLI as a local `MediaUnderstandingProvider`, giving any OpenClaw channel offline whisper.cpp audio transcription without cloud API calls.

This repo is a thin TypeScript adapter — all transcription logic lives in the `minutes` binary from the parent project. See `../minutes/CLAUDE.md` for the full CLI architecture.

## Stack

- TypeScript, compiled with `tsc`
- `vitest` for unit/integration tests
- OpenClaw plugin SDK (`openclaw/plugin-sdk/plugin-entry`, peer dep, dev-only)
- External dependency: `minutes` CLI binary (whisper.cpp wrapper, separate repo)

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
test/
  provider.test.ts              Contract tests (id, capabilities, auth, priority, transcribeAudio)
  minutes-backend.test.ts       Full coverage of CLI args, extension detection, JSON parsing
```

### Data flow

`OpenClaw audio request` → `provider.ts:transcribeAudio` → `minutes-backend.ts:runMinutes`:
1. Buffer written to temp file (extension from `fileName` or MIME)
2. `minutes transcribe <temp> --json [-l <lang>]` spawned — requires a `minutes` build
   with [silverstein/minutes#380](https://github.com/silverstein/minutes/pull/380)
3. JSON envelope parsed: `{ ok, data: { text, language, segments, duration_ms } }`
4. `data.text` returned as-is; `model` is reported as the constant `"whisper.cpp"`
   (the envelope doesn't carry the specific model file used)
5. Temp file always deleted. No meeting files are ever written — there is nothing
   else to clean up.

### Priority

`autoPriority: { audio: 10 }` — lower beats bundled cloud providers (openai=20, xai=25, openrouter=35, google/senseaudio=40, mistral=50). Minutes is tried first when installed.

### Testability pattern

`MinutesBackendDeps` in `minutes-backend.ts` injects all I/O (`exec`, `writeTemp`, `unlink`). Unit tests use `makeDeps()` helpers that never touch disk or spawn processes. The live test at the bottom of `minutes-backend.test.ts` is the only test that calls the real binary, and it's gated by `MINUTES_OPENCLAW_LIVE=1`.

## OpenClaw plugin contract

- `openclaw.plugin.json` declares `contracts.mediaUnderstandingProviders: ["minutes"]` and the config schema (`minutesBin`, `language`).
- The plugin uses `definePluginEntry` from `openclaw/plugin-sdk/plugin-entry` (peer dep, `devDependencies` only).
- `resolveAuth` returns `{ kind: "none" }` — no API key is needed.
- `defaultModels: { audio: "whisper.cpp" }` is required by OpenClaw's provider resolution.

## Config exposed to OpenClaw users

| Key | Default | Description |
|---|---|---|
| `minutesBin` | `"minutes"` (or `$MINUTES_BIN`) | Path to the `minutes` binary |
| `language` | — | Default language code; per-request language takes precedence |

## Restricciones técnicas / historia relevante

- Versions `<0.2.0` shelled out to `minutes process -t memo` and scraped the generated `.md` memo's `## Transcript` section, with a `persistMemo` option controlling whether that memo file was kept.
- `0.2.0+` uses `minutes transcribe --json` instead, which writes no files at all, so `persistMemo` was removed rather than deprecated. No debe reintroducirse ese flujo.

---

## Comportamiento del agente

### MCP Tools: code-review-graph

**ALWAYS use the code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives structural
context (callers, dependents, test coverage) that file scanning cannot.

| Necesidad | Usar |
|---|---|
| Explorar código | `semantic_search_nodes` o `query_graph` (no Grep) |
| Entender impacto de un cambio | `get_impact_radius` (no rastrear imports a mano) |
| Code review | `detect_changes` + `get_review_context` (no leer archivos completos) |
| Relaciones entre nodos | `query_graph` con callers_of/callees_of/imports_of/tests_for |
| Preguntas de arquitectura | `get_architecture_overview` + `list_communities` |

Caer a Grep/Glob/Read **solo** cuando el grafo no cubra lo necesario.

### Control de tokens

- Inputs cortos y específicos. Sin repetir contexto ya dado.
- Compartir solo los campos clave, no datos completos.
- No usar modelos pesados para tareas simples.
- Caveman rule: sin relleno, sin yapping. Respuestas directas.

### Qué NO hacer

- No generar código salvo que se pida explícitamente.
- No ampliar el alcance sin confirmación.
- No reintroducir el flujo de `persistMemo` / scraping de memos `.md`.
- No usar Grep/Glob/Read como primera opción si el MCP `code-review-graph` puede responder la consulta.