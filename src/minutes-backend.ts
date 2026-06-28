/**
 * Bridge between OpenClaw's MediaUnderstandingProvider contract and the
 * `minutes process` CLI command.
 *
 * All I/O dependencies are injectable so unit tests run without disk or
 * process access. Production code uses `defaultDeps`.
 */
import { spawn } from "node:child_process";
import { readFile as fsReadFile, unlink as fsUnlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { extractFrontmatterModel, extractTranscript } from "./transcript.js";

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
  /** Read a file as a UTF-8 string. */
  readFile: (filePath: string) => Promise<string>;
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
  /** When false, the .md memo created by `minutes process` is deleted after reading. */
  persistMemo: boolean;
  /** Path or name of the minutes binary. Defaults to "minutes". */
  minutesBin: string;
};

type MinutesProcessOutput = {
  status: string;
  file: string;
  title?: string;
  words?: number;
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
 * 2. Spawning `minutesBin process <temp> -t memo [-l language]`.
 * 3. Parsing the JSON stdout to get the output .md path.
 * 4. Reading the .md and extracting the `## Transcript` section.
 * 5. Optionally deleting the .md (when persistMemo is false).
 * 6. Always deleting the temp audio file.
 */
export async function runMinutes(
  params: RunMinutesParams,
  deps: MinutesBackendDeps,
): Promise<{ text: string; model?: string }> {
  const ext = getAudioExtension(params.fileName, params.mime);
  const tempPath = await deps.writeTemp(params.buffer, ext);

  try {
    const args = ["process", tempPath, "-t", "memo"];
    const lang = params.language?.trim();
    if (lang) {
      args.push("-l", lang);
    }

    const { stdout } = await deps.exec(params.minutesBin, args, params.timeoutMs);

    let output: MinutesProcessOutput;
    try {
      output = JSON.parse(stdout.trim()) as MinutesProcessOutput;
    } catch {
      throw new Error(
        `minutes-openclaw: failed to parse minutes output as JSON.\n` +
          `stdout (first 400 chars): ${stdout.slice(0, 400)}`,
      );
    }

    if (output.status !== "done" || !output.file) {
      throw new Error(
        `minutes-openclaw: unexpected output from minutes process: ${JSON.stringify(output)}`,
      );
    }

    const memoPath = output.file;
    const markdown = await deps.readFile(memoPath);
    const text = extractTranscript(markdown);
    const model = extractFrontmatterModel(markdown) ?? "whisper.cpp";

    if (!params.persistMemo) {
      await deps.unlink(memoPath).catch(() => {});
    }

    return { text, model };
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

async function defaultReadFile(filePath: string): Promise<string> {
  return fsReadFile(filePath, "utf8");
}

async function defaultUnlink(filePath: string): Promise<void> {
  await fsUnlink(filePath);
}

export const defaultDeps: MinutesBackendDeps = {
  exec: defaultExec,
  writeTemp: defaultWriteTemp,
  readFile: defaultReadFile,
  unlink: defaultUnlink,
};
