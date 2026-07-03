// Unit tests for minutes-backend.ts — all I/O is injected; no disk/network.
import { describe, expect, it } from "vitest";
import { runMinutes, type MinutesBackendDeps } from "../src/minutes-backend.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeEnvelope(overrides: Partial<{
  ok: boolean;
  text: string;
  language: string;
  segments: Array<{ start: number; end: number; text: string; speaker?: string }>;
  duration_ms: number;
}> = {}) {
  const { ok = true, text = "Hello, this is a test transcription.", language = "en", segments = [], duration_ms = 4200 } = overrides;
  return JSON.stringify({
    ok,
    command: "transcribe",
    data: { text, language, segments, duration_ms },
    meta: { schemaVersion: 1, generatedAt: "2026-06-30T00:00:00Z" },
  });
}

function makeDeps(overrides: Partial<MinutesBackendDeps> = {}): MinutesBackendDeps {
  return {
    exec: async () => ({ stdout: makeEnvelope(), stderr: "" }),
    writeTemp: async (_buffer, ext) => `/tmp/minutes-openclaw-test${ext}`,
    unlink: async () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Argument passing
// ---------------------------------------------------------------------------

describe("runMinutes — CLI args", () => {
  it("passes 'transcribe', temp path, '--json' as core args", async () => {
    let capturedBin = "";
    let capturedArgs: string[] = [];

    await runMinutes(
      {
        buffer: Buffer.from("audio-bytes"),
        fileName: "voice.wav",
        timeoutMs: 5_000,
        minutesBin: "minutes",
      },
      makeDeps({
        writeTemp: async (_buf, ext) => `/tmp/test${ext}`,
        exec: async (bin, args) => {
          capturedBin = bin;
          capturedArgs = args;
          return { stdout: makeEnvelope(), stderr: "" };
        },
      }),
    );

    expect(capturedBin).toBe("minutes");
    expect(capturedArgs[0]).toBe("transcribe");
    expect(capturedArgs[1]).toBe("/tmp/test.wav");
    expect(capturedArgs[2]).toBe("--json");
    expect(capturedArgs).not.toContain("-l");
  });

  it("appends -l when language is provided", async () => {
    let capturedArgs: string[] = [];

    await runMinutes(
      {
        buffer: Buffer.from("audio"),
        fileName: "voice.ogg",
        language: "es",
        timeoutMs: 5_000,
        minutesBin: "minutes",
      },
      makeDeps({
        exec: async (_bin, args) => {
          capturedArgs = args;
          return { stdout: makeEnvelope(), stderr: "" };
        },
      }),
    );

    const lIdx = capturedArgs.indexOf("-l");
    expect(lIdx).toBeGreaterThan(-1);
    expect(capturedArgs[lIdx + 1]).toBe("es");
  });

  it("does not append -l when language is empty/whitespace", async () => {
    let capturedArgs: string[] = [];

    await runMinutes(
      {
        buffer: Buffer.from("audio"),
        fileName: "voice.mp3",
        language: "  ",
        timeoutMs: 5_000,
        minutesBin: "minutes",
      },
      makeDeps({
        exec: async (_bin, args) => {
          capturedArgs = args;
          return { stdout: makeEnvelope(), stderr: "" };
        },
      }),
    );

    expect(capturedArgs).not.toContain("-l");
  });

  it("uses the custom minutesBin", async () => {
    let capturedBin = "";

    await runMinutes(
      {
        buffer: Buffer.from("audio"),
        fileName: "note.wav",
        timeoutMs: 5_000,
        minutesBin: "/opt/homebrew/bin/minutes",
      },
      makeDeps({
        exec: async (bin) => {
          capturedBin = bin;
          return { stdout: makeEnvelope(), stderr: "" };
        },
      }),
    );

    expect(capturedBin).toBe("/opt/homebrew/bin/minutes");
  });
});

// ---------------------------------------------------------------------------
// Extension detection
// ---------------------------------------------------------------------------

describe("runMinutes — extension from fileName / mime", () => {
  it("uses .wav extension from fileName", async () => {
    let writtenExt = "";
    await runMinutes(
      { buffer: Buffer.from("x"), fileName: "voice.wav", timeoutMs: 5_000, minutesBin: "minutes" },
      makeDeps({ writeTemp: async (_buf, ext) => { writtenExt = ext; return `/tmp/test${ext}`; } }),
    );
    expect(writtenExt).toBe(".wav");
  });

  it("uses .ogg extension from fileName for WhatsApp voice notes", async () => {
    let writtenExt = "";
    await runMinutes(
      { buffer: Buffer.from("x"), fileName: "PTT-20260628.ogg", timeoutMs: 5_000, minutesBin: "minutes" },
      makeDeps({ writeTemp: async (_buf, ext) => { writtenExt = ext; return `/tmp/test${ext}`; } }),
    );
    expect(writtenExt).toBe(".ogg");
  });

  it("falls back to .wav when MIME is unknown and fileName has no extension", async () => {
    let writtenExt = "";
    await runMinutes(
      { buffer: Buffer.from("x"), fileName: "audio", mime: "application/octet-stream", timeoutMs: 5_000, minutesBin: "minutes" },
      makeDeps({ writeTemp: async (_buf, ext) => { writtenExt = ext; return `/tmp/test${ext}`; } }),
    );
    expect(writtenExt).toBe(".wav");
  });

  it("uses .mp3 from MIME when fileName has no extension", async () => {
    let writtenExt = "";
    await runMinutes(
      { buffer: Buffer.from("x"), fileName: "audio", mime: "audio/mpeg", timeoutMs: 5_000, minutesBin: "minutes" },
      makeDeps({ writeTemp: async (_buf, ext) => { writtenExt = ext; return `/tmp/test${ext}`; } }),
    );
    expect(writtenExt).toBe(".mp3");
  });
});

// ---------------------------------------------------------------------------
// JSON stdout parsing
// ---------------------------------------------------------------------------

describe("runMinutes — stdout parsing", () => {
  it("returns transcript text from the JSON envelope", async () => {
    const result = await runMinutes(
      { buffer: Buffer.from("audio"), fileName: "voice.wav", timeoutMs: 5_000, minutesBin: "minutes" },
      makeDeps({ exec: async () => ({ stdout: makeEnvelope({ text: "Hello, this is a test transcription." }), stderr: "" }) }),
    );
    expect(result.text).toBe("Hello, this is a test transcription.");
  });

  it("reports the whisper.cpp model constant", async () => {
    const result = await runMinutes(
      { buffer: Buffer.from("audio"), fileName: "voice.wav", timeoutMs: 5_000, minutesBin: "minutes" },
      makeDeps(),
    );
    expect(result.model).toBe("whisper.cpp");
  });

  it("returns empty string when the transcript is empty", async () => {
    const result = await runMinutes(
      { buffer: Buffer.from("audio"), fileName: "voice.wav", timeoutMs: 5_000, minutesBin: "minutes" },
      makeDeps({ exec: async () => ({ stdout: makeEnvelope({ text: "" }), stderr: "" }) }),
    );
    expect(result.text).toBe("");
  });

  it("handles pretty-printed multi-line JSON stdout", async () => {
    const prettyOutput = JSON.stringify(
      JSON.parse(makeEnvelope({ text: "Pretty printed." })),
      null,
      2,
    );
    const result = await runMinutes(
      { buffer: Buffer.from("audio"), fileName: "voice.wav", timeoutMs: 5_000, minutesBin: "minutes" },
      makeDeps({ exec: async () => ({ stdout: prettyOutput, stderr: "" }) }),
    );
    expect(result.text).toBe("Pretty printed.");
  });

  it("throws when stdout is not valid JSON", async () => {
    await expect(
      runMinutes(
        { buffer: Buffer.from("audio"), fileName: "voice.wav", timeoutMs: 5_000, minutesBin: "minutes" },
        makeDeps({ exec: async () => ({ stdout: "not json", stderr: "" }) }),
      ),
    ).rejects.toThrow("failed to parse minutes output");
  });

  it("throws when ok is false", async () => {
    await expect(
      runMinutes(
        { buffer: Buffer.from("audio"), fileName: "voice.wav", timeoutMs: 5_000, minutesBin: "minutes" },
        makeDeps({ exec: async () => ({ stdout: makeEnvelope({ ok: false }), stderr: "" }) }),
      ),
    ).rejects.toThrow("unexpected output");
  });

  it("throws when data.text is missing", async () => {
    await expect(
      runMinutes(
        { buffer: Buffer.from("audio"), fileName: "voice.wav", timeoutMs: 5_000, minutesBin: "minutes" },
        makeDeps({ exec: async () => ({ stdout: JSON.stringify({ ok: true, command: "transcribe", data: {} }), stderr: "" }) }),
      ),
    ).rejects.toThrow("unexpected output");
  });
});

// ---------------------------------------------------------------------------
// Temp file cleanup
// ---------------------------------------------------------------------------

describe("runMinutes — temp file cleanup", () => {
  it("always deletes the temp audio file on success", async () => {
    const deletedPaths: string[] = [];
    const TEMP = "/tmp/minutes-openclaw-testtest.wav";

    await runMinutes(
      { buffer: Buffer.from("audio"), fileName: "voice.wav", timeoutMs: 5_000, minutesBin: "minutes" },
      makeDeps({
        writeTemp: async (_buf, ext) => TEMP,
        unlink: async (p) => { deletedPaths.push(p); },
      }),
    );

    expect(deletedPaths).toContain(TEMP);
  });

  it("cleans up temp even when exec throws", async () => {
    const deletedPaths: string[] = [];
    const TEMP = "/tmp/minutes-openclaw-err.wav";

    await expect(
      runMinutes(
        { buffer: Buffer.from("audio"), fileName: "voice.wav", timeoutMs: 5_000, minutesBin: "minutes" },
        makeDeps({
          writeTemp: async (_buf, ext) => TEMP,
          exec: async () => { throw new Error("minutes not found"); },
          unlink: async (p) => { deletedPaths.push(p); },
        }),
      ),
    ).rejects.toThrow("minutes not found");

    expect(deletedPaths).toContain(TEMP);
  });
});

// ---------------------------------------------------------------------------
// Live test (gated by MINUTES_OPENCLAW_LIVE=1)
// ---------------------------------------------------------------------------

describe("runMinutes — live", () => {
  it("transcribes demo.wav with the real minutes binary (skip unless MINUTES_OPENCLAW_LIVE=1)", async () => {
    if (process.env["MINUTES_OPENCLAW_LIVE"] !== "1") return;

    // Check minutes is available
    const { execSync } = await import("node:child_process");
    try {
      execSync("minutes --version", { stdio: "ignore" });
    } catch {
      console.warn("Skipping live test: minutes binary not found in PATH");
      return;
    }

    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const demoWavPath = fileURLToPath(
      new URL("./fixtures/demo.wav", import.meta.url),
    );
    const buffer = readFileSync(demoWavPath);

    const { defaultDeps } = await import("../src/minutes-backend.js");
    const result = await runMinutes(
      {
        buffer,
        fileName: "demo.wav",
        mime: "audio/wav",
        timeoutMs: 120_000,
        minutesBin: process.env["MINUTES_BIN"] ?? "minutes",
      },
      defaultDeps,
    );

    expect(typeof result.text).toBe("string");
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.model).toBeTruthy();
  }, 120_000);
});
