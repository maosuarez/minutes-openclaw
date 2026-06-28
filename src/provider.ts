/**
 * MediaUnderstandingProvider that delegates audio transcription to the
 * local `minutes` CLI (whisper.cpp, no network, no API key required).
 *
 * autoPriority: { audio: 10 } — LOWER number = preferred in OpenClaw's
 * ascending sort. This beats all bundled cloud providers:
 *   openai=20, xai=25, openrouter=35, google=40, senseaudio=40, mistral=50
 * so Minutes is tried first when the user has it configured.
 */
import type {
  AudioTranscriptionRequest,
  MediaUnderstandingProvider,
} from "openclaw/plugin-sdk/media-understanding";
import { defaultDeps, runMinutes, type MinutesBackendDeps } from "./minutes-backend.js";

export type MinutesProviderConfig = {
  /** Save transcribed audio as a .md memo in ~/meetings/memos/. Default: true. */
  persistMemo: boolean;
  /** Path or name of the minutes binary. Default: MINUTES_BIN env or "minutes". */
  minutesBin: string;
  /** Default language code when the channel does not provide one. */
  language?: string;
};

const DEFAULT_CONFIG: MinutesProviderConfig = {
  persistMemo: true,
  minutesBin: process.env["MINUTES_BIN"] ?? "minutes",
};

/**
 * Factory for testability — lets tests inject a custom config and deps.
 */
export function createMinutesProvider(
  config: MinutesProviderConfig = DEFAULT_CONFIG,
  deps: MinutesBackendDeps = defaultDeps,
): MediaUnderstandingProvider {
  return {
    id: "minutes",
    capabilities: ["audio"],
    // OpenClaw needs a model advertised per capability to resolve/select the
    // provider (mirrors senseaudio's defaultModels). "whisper.cpp" matches the
    // model string runMinutes reports back in AudioTranscriptionResult.
    defaultModels: { audio: "whisper.cpp" },
    // Lower = higher priority in OpenClaw's ascending auto-selection sort.
    autoPriority: { audio: 10 },
    // No API key needed — minutes runs fully local via whisper.cpp.
    resolveAuth: () => ({
      kind: "none",
      source: "minutes local whisper.cpp — no auth required",
    }),
    transcribeAudio: (req: AudioTranscriptionRequest) =>
      runMinutes(
        {
          buffer: req.buffer,
          fileName: req.fileName,
          mime: req.mime,
          // Per-request language wins over provider default.
          language: req.language ?? config.language,
          timeoutMs: req.timeoutMs,
          persistMemo: config.persistMemo,
          minutesBin: config.minutesBin,
        },
        deps,
      ),
  };
}

/** Singleton provider with production defaults. Used by the plugin entry point. */
export const minutesMediaUnderstandingProvider: MediaUnderstandingProvider =
  createMinutesProvider(DEFAULT_CONFIG, defaultDeps);
