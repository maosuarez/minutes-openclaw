/**
 * Bridge between OpenClaw's MediaUnderstandingProvider contract and the
 * `minutes transcribe --json` CLI command.
 *
 * All I/O dependencies are injectable so unit tests run without disk or
 * process access. Production code uses `defaultDeps`.
 */
import { spawn } from "node:child_process";
import { unlink as fsUnlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type MinutesBackendDeps = {
  /** Spawn `bin args` with a timeout; resolve with stdout+stderr on exit 0. */
  exec: (
    bin: string,
    args: string[],
    timeoutMs: number,
  ) => Promise<{ stdout: string; stderr: string }>;
  /** Write `buffer` to a unique temp file with the given extension; return its path. */
  writeTemp: (buffer: Buffer, extension: string) => Promise<string>;
  /** Delete a file; errors are ignored by the caller (best-effort cleanup). */
  unlink: (filePath: string) => Promise<void>;
};

export type RunMinutesParams = {
  buffer: Buffer;
  /** Original filename from the request (used to derive extension). */
  fileName: string;
  /** MIME type from the request (fallback for extension detection). */
  mime?: string;
  /** Language code (e.g. "en", "es"). Omit to use whisper auto-detect. */
  language?: string;
  timeoutMs: number;
  /** Path or name of the minutes binary. Defaults to "minutes". */
  minutesBin: string;
};

/**
 * Shape of `minutes transcribe --json` stdout. Only the fields this backend
 * consumes are typed; see upstream `TranscribeOutput` in crates/cli for the
 * full contract (schema version 1).
 */
type TranscribeJsonEnvelope = {
  ok: boolean;
  command: string;
  data: {
    text: string;
    language: string;
    segments: Array<{ start: number; end: number; text: string; speaker?: string }>;
    duration_ms: number;
  };
};

// ---------------------------------------------------------------------------
// Extension detection
// ---------------------------------------------------------------------------

const KNOWN_AUDIO_EXTS = new Set([
  ".wav", ".mp3", ".m4a", ".ogg", ".opus", ".webm", ".flac", ".aac", ".wma",
]);

const MIME_TO_EXT: Record<string, string> = {
  "audio/wav": ".wav",
  "audio/wave": ".wav",
  "audio/x-wav": ".wav",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/mp4": ".m4a",
  "audio/m4a": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/ogg": ".ogg",
  "audio/opus": ".opus",
  "audio/webm": ".webm",
  "video/webm": ".webm",
  "audio/flac": ".flac",
  "audio/aac": ".aac",
};

function getAudioExtension(fileName: string, mime?: string): string {
  const fromName = path.extname(fileName).toLowerCase();
  if (fromName && KNOWN_AUDIO_EXTS.has(fromName)) return fromName;
  if (mime) {
    const normalized = mime.toLowerCase().split(";")[0]!.trim();
    const fromMime = MIME_TO_EXT[normalized];
    if (fromMime) return fromMime;
  }
  return ".wav"; // safe default — minutes + ffmpeg handle most formats
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Transcribes audio by:
 * 1. Writing the buffer to a temp file with the correct extension.
 * 2. Spawning `minutesBin transcribe <temp> --json [-l language]`.
 * 3. Parsing the JSON envelope's `data.text` field.
 * 4. Always deleting the temp audio file.
 *
 * No meeting files are written and nothing is persisted to disk beyond the
 * temp audio file, which is removed in the `finally` block below.
 */
export async function runMinutes(
  params: RunMinutesParams,
  deps: MinutesBackendDeps,
): Promise<{ text: string; model?: string }> {
  const ext = getAudioExtension(params.fileName, params.mime);
  const tempPath = await deps.writeTemp(params.buffer, ext);

  try {
    const args = ["transcribe", tempPath, "--json"];
    const lang = params.language?.trim();
    if (lang) {
      args.push("-l", lang);
    }

    const { stdout } = await deps.exec(params.minutesBin, args, params.timeoutMs);

    let envelope: TranscribeJsonEnvelope;
    try {
      envelope = JSON.parse(stdout.trim()) as TranscribeJsonEnvelope;
    } catch {
      throw new Error(
        `minutes-openclaw: failed to parse minutes output as JSON.\n` +
          `stdout (first 400 chars): ${stdout.slice(0, 400)}`,
      );
    }

    if (!envelope.ok || typeof envelope.data?.text !== "string") {
      throw new Error(
        `minutes-openclaw: unexpected output from minutes transcribe: ${JSON.stringify(envelope)}`,
      );
    }

    return { text: envelope.data.text, model: "whisper.cpp" };
  } finally {
    // Always remove the temp audio file regardless of success or failure.
    await deps.unlink(tempPath).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Default (production) deps — thin wrappers over Node.js built-ins
// ---------------------------------------------------------------------------

async function defaultExec(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const child = spawn(bin, args);

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`minutes-openclaw: minutes process timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            `minutes-openclaw: minutes exited with code ${code}.\n` +
              `stderr: ${stderr.slice(0, 500)}`,
          ),
        );
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function defaultWriteTemp(buffer: Buffer, extension: string): Promise<string> {
  const id = randomUUID().replace(/-/g, "").slice(0, 16);
  const filePath = path.join(os.tmpdir(), `minutes-openclaw-${id}${extension}`);
  await writeFile(filePath, buffer);
  return filePath;
}

async function defaultUnlink(filePath: string): Promise<void> {
  await fsUnlink(filePath);
}

export const defaultDeps: MinutesBackendDeps = {
  exec: defaultExec,
  writeTemp: defaultWriteTemp,
  unlink: defaultUnlink,
};
