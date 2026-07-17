import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Worker } from "../../shared/types";
import { ClaudeTranscriptTracker, failedSessionLookupRetryMs } from "./claudeTranscriptTracker";
import { resolveTranscriptPath } from "./claudeTranscript/io";
import { findClaudeSessionStartTimeMs } from "./claudeTranscript/process";

// Golden safety-net for the orchestration seams the tracker owns: transcript
// health surfacing (ok / absent / error), the failed-session-lookup retry
// cooldown, and the working -> finished contract end to end over a REAL
// transcript file.
//
// The tracker's configurable `projectRoot` lets these tests run real transcript
// resolution against a temp directory, so path resolution is NOT mocked. The io
// module is wrapped only as a passthrough spy so the one genuinely un-reproducible
// case — resolution *throwing* (health "error") — can be injected for a single
// call; every other test exercises the real resolveTranscriptPath. The PID lookup
// (pgrep/ps) is a real side effect, so it stays mocked.
vi.mock("./claudeTranscript/io", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./claudeTranscript/io")>();
  return { ...actual, resolveTranscriptPath: vi.fn(actual.resolveTranscriptPath) };
});

vi.mock("./claudeTranscript/process", () => ({
  findClaudeSessionStartTimeMs: vi.fn()
}));

const resolveSpy = vi.mocked(resolveTranscriptPath);
const sessionStartMock = vi.mocked(findClaudeSessionStartTimeMs);

let projectRoot: string;

beforeEach(async () => {
  vi.clearAllMocks();
  sessionStartMock.mockResolvedValue(undefined);
  // resolveSpy keeps its passthrough implementation (real resolution against the
  // temp projectRoot); individual tests override it only per-call where needed.
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arcane-claude-projects-"));
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

function createWorker(overrides: Partial<Worker> = {}): Worker {
  return {
    id: "worker-1",
    name: "worker-1",
    displayName: "worker-1",
    projectId: "project",
    projectPath: "/tmp/project",
    runtimeId: "claude",
    runtimeLabel: "Claude",
    command: ["claude"],
    status: "idle",
    activityText: undefined,
    activityTool: undefined,
    activityPath: undefined,
    avatarType: "wizard",
    movementMode: "hold",
    position: { x: 0, y: 0 },
    tmuxRef: { session: "arcane-agents", window: "worker-1", pane: "%1" },
    createdAt: "2026-03-04T00:00:00.000Z",
    updatedAt: "2026-03-04T00:00:00.000Z",
    ...overrides
  };
}

function trackerForTemp(): ClaudeTranscriptTracker {
  return new ClaudeTranscriptTracker({ projectRoot });
}

function line(value: unknown): string {
  return JSON.stringify(value);
}

function assistantToolUse(id: string, name: string, input: Record<string, unknown> = {}): string {
  return line({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
}

function assistantText(value: string): string {
  return line({ type: "assistant", message: { content: [{ type: "text", text: value }] } });
}

function systemTurnDuration(): string {
  return line({ type: "system", subtype: "turn_duration" });
}

/** The real per-project transcript directory the tracker resolves for a worker. */
function transcriptDirFor(worker: Worker): string {
  return path.join(projectRoot, worker.projectPath.replace(/[^a-zA-Z0-9-]/g, "-"));
}

async function writeTranscript(worker: Worker, name: string, records: string[]): Promise<string> {
  const dir = transcriptDirFor(worker);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, `${records.join("\n")}\n`, "utf8");
  return filePath;
}

describe("ClaudeTranscriptTracker", () => {
  it("returns an absent result for a non-claude session without attempting resolution", async () => {
    const worker = createWorker({ runtimeId: "opencode", command: ["opencode"] });

    const result = await trackerForTemp().poll(worker, "opencode");

    expect(result.snapshot).toBeUndefined();
    expect(result.health).toBe("absent");
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it("returns an absent result (no snapshot) when no transcript exists under the root", async () => {
    // Empty temp root: real resolution finds no candidate directory -> undefined.
    const result = await trackerForTemp().poll(createWorker(), "claude");

    expect(result.snapshot).toBeUndefined();
    expect(result.health).toBe("absent");
  });

  it("reports transcript health 'error' when resolution throws, without a snapshot", async () => {
    // The worker still gets no transcript-derived snapshot (its status falls back
    // to pane heuristics downstream), but health now distinguishes a broken
    // transcript from a merely absent one. Resolution throwing is the one case a
    // real temp dir can't reproduce, so it is injected for this single call.
    resolveSpy.mockRejectedValueOnce(new Error("resolution failed"));

    const result = await trackerForTemp().poll(createWorker(), "claude");

    expect(result.snapshot).toBeUndefined();
    expect(result.health).toBe("error");
  });

  it("retries the claude session-start lookup only after the failure cooldown elapses", async () => {
    // A failed pgrep/ps lookup used to be cached forever (the falsy `0` sentinel
    // fooled the `=== undefined` retry guard). It is now retried after a cooldown:
    // not within the window, but once past it.
    vi.useFakeTimers();
    try {
      const baseMs = Date.UTC(2026, 6, 18, 3, 0, 0);
      vi.setSystemTime(baseMs);
      sessionStartMock.mockResolvedValue(undefined);
      const tracker = trackerForTemp();
      const worker = createWorker();

      await tracker.poll(worker, "claude", undefined, 4242); // first lookup fails
      await tracker.poll(worker, "claude", undefined, 4242); // still within cooldown -> no retry
      expect(sessionStartMock).toHaveBeenCalledTimes(1);

      vi.setSystemTime(baseMs + failedSessionLookupRetryMs + 1); // past the cooldown

      await tracker.poll(worker, "claude", undefined, 4242); // retried
      expect(sessionStartMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not repeat the session-start lookup after a successful result either", async () => {
    sessionStartMock.mockResolvedValue(1_700_000_000_000);
    const tracker = trackerForTemp();
    const worker = createWorker();

    await tracker.poll(worker, "claude", undefined, 4242);
    await tracker.poll(worker, "claude", undefined, 4242);

    expect(sessionStartMock).toHaveBeenCalledTimes(1);
  });

  it("reports working for an active tool, then idle after a turn_duration record", async () => {
    const worker = createWorker();
    const file = await writeTranscript(worker, "session.jsonl", [assistantToolUse("t1", "Bash", { command: "npm test" })]);
    const tracker = trackerForTemp();

    const working = await tracker.poll(worker, "claude");
    expect(working.snapshot?.status).toBe("working");
    expect(working.health).toBe("ok");

    await fs.appendFile(file, `${systemTurnDuration()}\n`, "utf8");

    const finished = await tracker.poll(worker, "claude");
    expect(finished.snapshot?.status).toBe("idle");
    expect(finished.health).toBe("ok");
  });

  it("does not report working from a text-only tail on first attach, but does for a fresh event", async () => {
    // On first attach the busy window is zeroed so a historical text-only tail does
    // not read as active work.
    const worker = createWorker();
    const file = await writeTranscript(worker, "session.jsonl", [assistantText("earlier reply")]);
    const tracker = trackerForTemp();

    const firstAttach = await tracker.poll(worker, "claude");
    expect(firstAttach.snapshot?.status).toBe("idle");

    // A genuinely new text event after attach opens the busy window -> working.
    await fs.appendFile(file, `${assistantText("a new reply")}\n`, "utf8");

    const afterNewEvent = await tracker.poll(worker, "claude");
    expect(afterNewEvent.snapshot?.status).toBe("working");
  });

  it("resets accumulated state when the resolved transcript path changes", async () => {
    const worker = createWorker();
    const first = await writeTranscript(worker, "first.jsonl", [assistantToolUse("t1", "Bash", { command: "run" })]);
    const tracker = trackerForTemp();

    expect((await tracker.poll(worker, "claude")).snapshot?.status).toBe("working");

    // Replace the session file: remove the first, leaving only a finished-turn
    // second file for real resolution to pick up.
    await fs.rm(first);
    await writeTranscript(worker, "second.jsonl", [systemTurnDuration()]);

    // The tracker should re-bootstrap against the new file rather than carry the
    // previous file's active tool forward.
    expect((await tracker.poll(worker, "claude")).snapshot?.status).toBe("idle");
  });
});
