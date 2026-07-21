import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTranscriptState } from "./accumulator";
import { bootstrapTailBytes } from "./constants";
import { collectTranscriptInputLines, findClaudeProjectRootInEnvironment } from "./io";
import type { ClaudeTranscriptState } from "./types";

// Golden safety-net for the incremental tail reader: byte-offset math, partial
// lines across chunk boundaries, no-growth polls, truncation/rotation, and the
// leading-partial-line drop when bootstrapping from the tail of a large file.

let workDir: string;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "arcane-transcript-io-"));
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

async function writeTranscript(name: string, content: string): Promise<string> {
  const filePath = path.join(workDir, name);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

function stateFor(transcriptPath: string): ClaudeTranscriptState {
  const state = createTranscriptState();
  state.transcriptPath = transcriptPath;
  return state;
}

async function fileSize(filePath: string): Promise<number> {
  const stats = await fs.stat(filePath);
  return stats.size;
}

describe("findClaudeProjectRootInEnvironment", () => {
  it("uses the custom Claude config directory inherited by the live process", () => {
    const environment = Buffer.from("HOME=/home/test\0CLAUDE_CONFIG_DIR=/home/test/.claude-min\0PATH=/usr/bin\0");

    expect(findClaudeProjectRootInEnvironment(environment)).toBe("/home/test/.claude-min/projects");
  });

  it("ignores missing, empty, or relative config directories", () => {
    expect(findClaudeProjectRootInEnvironment(Buffer.from("HOME=/home/test\0"))).toBeUndefined();
    expect(findClaudeProjectRootInEnvironment(Buffer.from("CLAUDE_CONFIG_DIR=\0"))).toBeUndefined();
    expect(findClaudeProjectRootInEnvironment(Buffer.from("CLAUDE_CONFIG_DIR=.claude-min\0"))).toBeUndefined();
  });
});

describe("collectTranscriptInputLines", () => {
  it("returns nothing when no transcript path is set", async () => {
    const state = createTranscriptState();
    expect(await collectTranscriptInputLines(state)).toEqual([]);
  });

  it("returns nothing when the transcript path is a directory", async () => {
    const state = stateFor(workDir);
    expect(await collectTranscriptInputLines(state)).toEqual([]);
  });

  it("bootstraps a small file, returning complete lines and buffering a trailing partial line", async () => {
    const file = await writeTranscript("t.jsonl", '{"a":1}\n{"b":2}\n{"c":3');
    const state = stateFor(file);

    const lines = await collectTranscriptInputLines(state);

    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(state.lineBuffer).toBe('{"c":3');
    expect(state.initialized).toBe(true);
    expect(state.fileOffset).toBe(await fileSize(file));
  });

  it("returns only newly appended records on a subsequent poll", async () => {
    const file = await writeTranscript("t.jsonl", '{"a":1}\n{"b":2}\n');
    const state = stateFor(file);

    expect(await collectTranscriptInputLines(state)).toEqual(['{"a":1}', '{"b":2}']);

    await fs.appendFile(file, '{"c":3}\n{"d":4}\n', "utf8");

    expect(await collectTranscriptInputLines(state)).toEqual(['{"c":3}', '{"d":4}']);
    expect(state.fileOffset).toBe(await fileSize(file));
  });

  it("reassembles a single record that is split across two polls", async () => {
    const file = await writeTranscript("t.jsonl", '{"a":1}\n{"b":2');
    const state = stateFor(file);

    expect(await collectTranscriptInputLines(state)).toEqual(['{"a":1}']);
    expect(state.lineBuffer).toBe('{"b":2');

    await fs.appendFile(file, "}\n", "utf8");

    expect(await collectTranscriptInputLines(state)).toEqual(['{"b":2}']);
    expect(state.lineBuffer).toBe("");
  });

  it("returns nothing when the file has not grown", async () => {
    const file = await writeTranscript("t.jsonl", '{"a":1}\n');
    const state = stateFor(file);

    await collectTranscriptInputLines(state);
    expect(await collectTranscriptInputLines(state)).toEqual([]);
  });

  it("re-bootstraps from the tail when the file shrinks (truncation / rotation)", async () => {
    const file = await writeTranscript("t.jsonl", '{"a":1}\n{"b":2}\n{"c":3}\n');
    const state = stateFor(file);

    await collectTranscriptInputLines(state);
    const offsetBeforeTruncate = state.fileOffset;

    // Simulate a rotated / truncated transcript that is now smaller.
    await fs.writeFile(file, '{"z":9}\n', "utf8");
    const lines = await collectTranscriptInputLines(state);

    expect(state.fileOffset).toBeLessThan(offsetBeforeTruncate);
    expect(state.fileOffset).toBe(await fileSize(file));
    expect(lines).toEqual(['{"z":9}']);
  });

  it("drops the leading partial line when bootstrapping from the tail of a large file", async () => {
    // Each line is a fixed size so the file comfortably exceeds the tail window,
    // which forces the tail read to start part-way through a line.
    const padding = "P".repeat(1_000);
    const lineCount = Math.ceil(bootstrapTailBytes / 1_010) + 40;
    const rows: string[] = [];
    for (let idx = 0; idx < lineCount; idx += 1) {
      rows.push(JSON.stringify({ type: "system", subtype: "noop", idx, pad: padding }));
    }
    const file = await writeTranscript("big.jsonl", `${rows.join("\n")}\n`);
    expect(await fileSize(file)).toBeGreaterThan(bootstrapTailBytes);

    const state = stateFor(file);
    const lines = await collectTranscriptInputLines(state);

    // The truncated leading fragment must have been dropped: every returned line
    // is complete and parseable.
    for (const l of lines) {
      expect(() => JSON.parse(l)).not.toThrow();
    }

    const idxs = lines.map((l) => (JSON.parse(l) as { idx: number }).idx);
    // Tail-only: the earliest records are excluded...
    expect(idxs[0]).toBeGreaterThan(0);
    // ...but the most recent record is present.
    expect(idxs[idxs.length - 1]).toBe(lineCount - 1);
    // Indexes are contiguous and ascending (no gaps / duplicates).
    for (let i = 1; i < idxs.length; i += 1) {
      expect(idxs[i]).toBe((idxs[i - 1] ?? 0) + 1);
    }
    // File ended with a newline, so no partial line remains buffered.
    expect(state.lineBuffer).toBe("");
    expect(state.initialized).toBe(true);
  });
});
