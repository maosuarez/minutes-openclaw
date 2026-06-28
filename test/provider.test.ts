// Unit tests for the MediaUnderstandingProvider contract.
// Uses createMinutesProvider with injected deps so no disk/network is touched.
import { describe, expect, it } from "vitest";
import { createMinutesProvider } from "../src/provider.js";
import type { MinutesBackendDeps } from "../src/minutes-backend.js";

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const MEMO_MARKDOWN = `---
title: Test memo
model: whisper-tiny
date: 2026-06-28
---

## Transcript

Testing one two three.

## Action Items

- None
`;

const MEMO_PATH = "/home/user/meetings/memos/2026-06-28-test.md";

function makeMinutesDeps(overrides: Partial<MinutesBackendDeps> = {}): MinutesBackendDeps {
  return {
    exec: async () => ({
      stdout: JSON.stringify({ status: "done", file: MEMO_PATH, title: "Test memo", words: 4 }),
      stderr: "",
    }),
    writeTemp: async (_buf, ext) => `/tmp/prov-test${ext}`,
    readFile: async () => MEMO_MARKDOWN,
    unlink: async () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Provider contract
// ---------------------------------------------------------------------------

describe("minutesMediaUnderstandingProvider — contract", () => {
  it("has the correct provider id", () => {
    const provider = createMinutesProvider();
    expect(provider.id).toBe("minutes");
  });

  it("declares audio capability", () => {
    const provider = createMinutesProvider();
    expect(provider.capabilities).toContain("audio");
  });

  it("advertises a default audio model so OpenClaw can resolve it", () => {
    const provider = createMinutesProvider();
    expect(provider.defaultModels?.audio).toBe("whisper.cpp");
  });

  it("resolves auth as kind:none (no API key required)", () => {
    const provider = createMinutesProvider();
    const auth = provider.resolveAuth?.({ provider: "minutes" } as never);
    expect(auth?.kind).toBe("none");
    expect((auth as { source?: string }).source).toMatch(/minutes/i);
  });

  it("autoPriority.audio is lower than openai (20) to be preferred locally", () => {
    const provider = createMinutesProvider();
    const priority = provider.autoPriority?.audio;
    expect(typeof priority).toBe("number");
    expect(priority!).toBeLessThan(20);
  });
});

// ---------------------------------------------------------------------------
// transcribeAudio
// ---------------------------------------------------------------------------

describe("minutesMediaUnderstandingProvider — transcribeAudio", () => {
  it("returns text from the transcript section", async () => {
    const deps = makeMinutesDeps();
    const provider = createMinutesProvider({ persistMemo: true, minutesBin: "minutes" }, deps);

    const result = await provider.transcribeAudio!({
      buffer: Buffer.from("audio"),
      fileName: "voice.wav",
      apiKey: "",
      timeoutMs: 5_000,
    });

    expect(result.text).toBe("Testing one two three.");
  });

  it("returns model from frontmatter", async () => {
    const deps = makeMinutesDeps();
    const provider = createMinutesProvider({ persistMemo: true, minutesBin: "minutes" }, deps);

    const result = await provider.transcribeAudio!({
      buffer: Buffer.from("audio"),
      fileName: "voice.wav",
      apiKey: "",
      timeoutMs: 5_000,
    });

    expect(result.model).toBe("whisper-tiny");
  });

  it("passes per-request language to minutes", async () => {
    let capturedArgs: string[] = [];
    const deps = makeMinutesDeps({
      exec: async (_bin, args) => {
        capturedArgs = args;
        return { stdout: JSON.stringify({ status: "done", file: MEMO_PATH }), stderr: "" };
      },
    });
    const provider = createMinutesProvider({ persistMemo: true, minutesBin: "minutes" }, deps);

    await provider.transcribeAudio!({
      buffer: Buffer.from("audio"),
      fileName: "voice.wav",
      apiKey: "",
      timeoutMs: 5_000,
      language: "fr",
    });

    const lIdx = capturedArgs.indexOf("-l");
    expect(lIdx).toBeGreaterThan(-1);
    expect(capturedArgs[lIdx + 1]).toBe("fr");
  });

  it("uses provider-level default language when request has none", async () => {
    let capturedArgs: string[] = [];
    const deps = makeMinutesDeps({
      exec: async (_bin, args) => {
        capturedArgs = args;
        return { stdout: JSON.stringify({ status: "done", file: MEMO_PATH }), stderr: "" };
      },
    });
    const provider = createMinutesProvider(
      { persistMemo: true, minutesBin: "minutes", language: "de" },
      deps,
    );

    await provider.transcribeAudio!({
      buffer: Buffer.from("audio"),
      fileName: "voice.wav",
      apiKey: "",
      timeoutMs: 5_000,
    });

    const lIdx = capturedArgs.indexOf("-l");
    expect(lIdx).toBeGreaterThan(-1);
    expect(capturedArgs[lIdx + 1]).toBe("de");
  });

  it("uses custom minutesBin from config", async () => {
    let capturedBin = "";
    const deps = makeMinutesDeps({
      exec: async (bin) => {
        capturedBin = bin;
        return { stdout: JSON.stringify({ status: "done", file: MEMO_PATH }), stderr: "" };
      },
    });
    const provider = createMinutesProvider(
      { persistMemo: true, minutesBin: "/usr/local/bin/minutes" },
      deps,
    );

    await provider.transcribeAudio!({
      buffer: Buffer.from("audio"),
      fileName: "voice.wav",
      apiKey: "",
      timeoutMs: 5_000,
    });

    expect(capturedBin).toBe("/usr/local/bin/minutes");
  });

  it("deletes memo when persistMemo is false", async () => {
    const deletedPaths: string[] = [];
    const deps = makeMinutesDeps({
      unlink: async (p) => { deletedPaths.push(p); },
    });
    const provider = createMinutesProvider({ persistMemo: false, minutesBin: "minutes" }, deps);

    await provider.transcribeAudio!({
      buffer: Buffer.from("audio"),
      fileName: "voice.wav",
      apiKey: "",
      timeoutMs: 5_000,
    });

    expect(deletedPaths).toContain(MEMO_PATH);
  });

  it("keeps memo when persistMemo is true", async () => {
    const deletedPaths: string[] = [];
    const deps = makeMinutesDeps({
      unlink: async (p) => { deletedPaths.push(p); },
    });
    const provider = createMinutesProvider({ persistMemo: true, minutesBin: "minutes" }, deps);

    await provider.transcribeAudio!({
      buffer: Buffer.from("audio"),
      fileName: "voice.wav",
      apiKey: "",
      timeoutMs: 5_000,
    });

    expect(deletedPaths).not.toContain(MEMO_PATH);
  });
});
