import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Worker } from "../../shared/types";
import { ClaudeTranscriptTracker } from "./claudeTranscriptTracker";
import { resolveTranscriptPath } from "./claudeTranscript/io";
import { findClaudeSessionStartTimeMs } from "./claudeTranscript/process";

// Golden safety-net for the orchestration seams the tracker owns: silent
// degradation when the transcript cannot be resolved, the "failed session
// lookup is never retried" sentinel, and the working -> finished contract end to
// end over a real transcript file (with only path resolution + PID lookup mocked).

// Mock only the two side-effecting seams. The real path resolution touches the
// user's ~/.claude/projects and the real PID lookup shells out to pgrep/ps, so
// both are replaced; collectTranscriptInputLines (real) still reads our files.
vi.mock("./claudeTranscript/io", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./claudeTranscript/io")>();
  return { ...actual, resolveTranscriptPath: vi.fn() };
});

vi.mock("./claudeTranscript/process", () => ({
  findClaudeSessionStartTimeMs: vi.fn()
}));

const resolveMock = vi.mocked(resolveTranscriptPath);
const sessionStartMock = vi.mocked(findClaudeSessionStartTimeMs);

let workDir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  sessionStartMock.mockResolvedValue(undefined);
  resolveMock.mockResolvedValue(undefined);
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "arcane-transcript-tracker-"));
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
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

async function writeTranscript(name: string, records: string[]): Promise<string> {
  const filePath = path.join(workDir, name);
  await fs.writeFile(filePath, `${records.join("\n")}\n`, "utf8");
  return filePath;
}

describe("ClaudeTranscriptTracker", () => {
  it("returns undefined for a non-claude session without attempting resolution", async () => {
    const tracker = new ClaudeTranscriptTracker();
    const worker = createWorker({ runtimeId: "opencode", command: ["opencode"] });

    const snapshot = await tracker.poll(worker, "opencode");

    expect(snapshot).toBeUndefined();
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("silently returns undefined when the transcript path cannot be resolved", async () => {
    resolveMock.mockResolvedValue(undefined);
    const tracker = new ClaudeTranscriptTracker();

    const snapshot = await tracker.poll(createWorker(), "claude");

    expect(snapshot).toBeUndefined();
  });

  it("silently returns undefined when transcript resolution throws", async () => {
    resolveMock.mockRejectedValue(new Error("resolution failed"));
    const tracker = new ClaudeTranscriptTracker();

    const snapshot = await tracker.poll(createWorker(), "claude");

    expect(snapshot).toBeUndefined();
  });

  it("does not retry the claude session-start lookup after a failed (sentinel 0) result", async () => {
    // The failed lookup is stored as the sentinel 0. Because the retry guard tests
    // `=== undefined` (not falsiness), 0 must count as "already looked up".
    sessionStartMock.mockResolvedValue(undefined);
    resolveMock.mockResolvedValue(undefined);
    const tracker = new ClaudeTranscriptTracker();
    const worker = createWorker();

    await tracker.poll(worker, "claude", undefined, 4242);
    await tracker.poll(worker, "claude", undefined, 4242);
    await tracker.poll(worker, "claude", undefined, 4242);

    expect(sessionStartMock).toHaveBeenCalledTimes(1);
  });

  it("does not repeat the session-start lookup after a successful result either", async () => {
    sessionStartMock.mockResolvedValue(1_700_000_000_000);
    resolveMock.mockResolvedValue(undefined);
    const tracker = new ClaudeTranscriptTracker();
    const worker = createWorker();

    await tracker.poll(worker, "claude", undefined, 4242);
    await tracker.poll(worker, "claude", undefined, 4242);

    expect(sessionStartMock).toHaveBeenCalledTimes(1);
  });

  it("reports working for an active tool, then idle after a turn_duration record", async () => {
    const file = await writeTranscript("session.jsonl", [assistantToolUse("t1", "Bash", { command: "npm test" })]);
    resolveMock.mockResolvedValue(file);
    const tracker = new ClaudeTranscriptTracker();
    const worker = createWorker();

    const working = await tracker.poll(worker, "claude");
    expect(working?.status).toBe("working");

    await fs.appendFile(file, `${systemTurnDuration()}\n`, "utf8");

    const finished = await tracker.poll(worker, "claude");
    expect(finished?.status).toBe("idle");
  });

  it("does not report working from a text-only tail on first attach, but does for a fresh event", async () => {
    // On first attach the busy window is zeroed so a historical text-only tail does
    // not read as active work.
    const file = await writeTranscript("session.jsonl", [assistantText("earlier reply")]);
    resolveMock.mockResolvedValue(file);
    const tracker = new ClaudeTranscriptTracker();
    const worker = createWorker();

    const firstAttach = await tracker.poll(worker, "claude");
    expect(firstAttach?.status).toBe("idle");

    // A genuinely new text event after attach opens the busy window -> working.
    await fs.appendFile(file, `${assistantText("a new reply")}\n`, "utf8");

    const afterNewEvent = await tracker.poll(worker, "claude");
    expect(afterNewEvent?.status).toBe("working");
  });

  it("resets accumulated state when the resolved transcript path changes", async () => {
    const first = await writeTranscript("first.jsonl", [assistantToolUse("t1", "Bash", { command: "run" })]);
    resolveMock.mockResolvedValue(first);
    const tracker = new ClaudeTranscriptTracker();
    const worker = createWorker();

    expect((await tracker.poll(worker, "claude"))?.status).toBe("working");

    // A new session file whose only record is a finished turn.
    const second = await writeTranscript("second.jsonl", [systemTurnDuration()]);
    resolveMock.mockResolvedValue(second);

    // The tracker should re-bootstrap against the new file rather than carry the
    // previous file's active tool forward.
    expect((await tracker.poll(worker, "claude"))?.status).toBe("idle");
  });
});
