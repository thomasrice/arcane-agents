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

// Real Claude transcript records carry a top-level ISO `timestamp`. Transcript
// resolution now reads the FIRST record's timestamp before attaching (the bounded
// mtime fallback validates it, and the session-start path matches against it), so
// fixtures give records a realistic timestamp. It defaults to now — a fresh-spawn
// transcript, exactly what the bounded fallback exists to attach — but can be
// aged to model a foreign or pre-existing session.
function nowIso(): string {
  return new Date().toISOString();
}

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function assistantToolUse(
  id: string,
  name: string,
  input: Record<string, unknown> = {},
  timestamp: string = nowIso()
): string {
  return line({ type: "assistant", timestamp, message: { content: [{ type: "tool_use", id, name, input }] } });
}

function assistantText(value: string, timestamp: string = nowIso()): string {
  return line({ type: "assistant", timestamp, message: { content: [{ type: "text", text: value }] } });
}

function systemTurnDuration(timestamp: string = nowIso()): string {
  return line({ type: "system", timestamp, subtype: "turn_duration" });
}

const DAY_MS = 24 * 60 * 60 * 1000;

async function setMtime(filePath: string, mtimeMs: number): Promise<void> {
  await fs.utimes(filePath, new Date(mtimeMs), new Date(mtimeMs));
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

  // --- Conservative transcript attachment in a shared project directory ---
  //
  // Panes whose Claude processes were started from the same cwd share ONE
  // transcript project directory. Attaching another session's transcript is
  // strictly worse than attaching none (pane heuristics still resolve status), so
  // resolution is conservative: a known session start never falls back to
  // newest-mtime, an unknown start uses only a bounded fallback, and one
  // transcript file binds to at most one worker.

  it("does not attach a hot foreign transcript when a known session start finds no match", async () => {
    // The live bug: a worker whose real Claude session is 38 days old (its own
    // transcript aged out of the 3-day mtime window) sat in a shared dir beside
    // another session's hot transcript, and the old newest-mtime fallback wrongly
    // attached it, flashing the idle worker as "working".
    const worker = createWorker({ createdAt: nowIso() });
    sessionStartMock.mockResolvedValue(Date.now() - 38 * DAY_MS);

    // Foreign transcript: recently modified (hot, inside the 3-day window) but its
    // first record is days old, so it cannot match the 38-day session start.
    await writeTranscript(worker, "foreign.jsonl", [
      assistantToolUse("t1", "Bash", { command: "npm test" }, isoAgo(6 * DAY_MS))
    ]);

    const tracker = trackerForTemp();
    const result = await tracker.poll(worker, "claude", undefined, 4242);

    expect(result.snapshot).toBeUndefined();
    expect(result.health).toBe("absent");

    // Stable across polls: it never latches onto the foreign transcript, so the
    // downstream decision keeps using pane heuristics.
    const again = await tracker.poll(worker, "claude", undefined, 4242);
    expect(again.snapshot).toBeUndefined();
    expect(again.health).toBe("absent");
  });

  it("attaches its own fresh transcript via the bounded fallback, not a hotter foreign one", async () => {
    // Unknown session start (pgrep not resolved yet). The worker's own brand-new
    // transcript must win over a foreign transcript with a newer mtime but an old
    // first record — the very case the old newest-mtime fallback got wrong.
    const worker = createWorker({ createdAt: nowIso() });

    const own = await writeTranscript(worker, "own.jsonl", [assistantToolUse("t1", "Bash", { command: "run" })]);
    const foreign = await writeTranscript(worker, "foreign.jsonl", [systemTurnDuration(isoAgo(2 * DAY_MS))]);
    // Foreign is the hotter file: the old fallback would have picked it (-> idle).
    await setMtime(own, Date.now() - 60_000);
    await setMtime(foreign, Date.now());

    const result = await trackerForTemp().poll(worker, "claude");

    expect(result.health).toBe("ok");
    expect(result.snapshot?.status).toBe("working");
  });

  it("rejects a fallback transcript whose first record predates the worker createdAt", async () => {
    // Fresh enough for the recency bound (5 min old) but older than createdAt
    // minus slack: a session cannot meaningfully predate the worker that hosts it.
    const worker = createWorker({ createdAt: nowIso() });
    await writeTranscript(worker, "early.jsonl", [
      assistantToolUse("t1", "Bash", { command: "run" }, isoAgo(5 * 60 * 1000))
    ]);

    const result = await trackerForTemp().poll(worker, "claude");

    expect(result.snapshot).toBeUndefined();
    expect(result.health).toBe("absent");
  });

  it("binds a transcript to one worker: a fallback challenger loses to the start-matched owner", async () => {
    const startMs = Date.now();
    const workerA = createWorker({ id: "worker-A" });
    const workerB = createWorker({ id: "worker-B", createdAt: nowIso() }); // same shared project dir
    const tracker = trackerForTemp();

    // Shared transcript whose first record matches A's session start.
    await writeTranscript(workerA, "shared.jsonl", [
      assistantToolUse("t1", "Bash", { command: "run" }, new Date(startMs).toISOString())
    ]);
    sessionStartMock.mockResolvedValue(startMs);

    // A resolves via a session-start match (strong) and owns the file.
    const a1 = await tracker.poll(workerA, "claude", undefined, 1111);
    expect(a1.health).toBe("ok");
    expect(a1.snapshot?.status).toBe("working");

    // B (unknown start) would fall back onto the same file, but A owns it, so B
    // gets nothing and keeps pane heuristics.
    const b1 = await tracker.poll(workerB, "claude");
    expect(b1.snapshot).toBeUndefined();
    expect(b1.health).toBe("absent");

    // A still owns the file.
    const a2 = await tracker.poll(workerA, "claude", undefined, 1111);
    expect(a2.health).toBe("ok");
  });

  it("evicts a weak fallback holder when a start-matched worker claims the same file", async () => {
    const startMs = Date.now();
    const workerA = createWorker({ id: "worker-A", createdAt: nowIso() });
    const workerB = createWorker({ id: "worker-B" }); // same shared project dir
    const tracker = trackerForTemp();

    await writeTranscript(workerA, "shared.jsonl", [
      assistantToolUse("t1", "Bash", { command: "run" }, new Date(startMs).toISOString())
    ]);

    // A attaches via the (weak) bounded fallback first.
    const a1 = await tracker.poll(workerA, "claude");
    expect(a1.health).toBe("ok");
    expect(a1.snapshot?.status).toBe("working");

    // B's session start matches the file: strong beats weak, so B takes it...
    sessionStartMock.mockResolvedValue(startMs);
    const b1 = await tracker.poll(workerB, "claude", undefined, 2222);
    expect(b1.health).toBe("ok");
    expect(b1.snapshot?.status).toBe("working");

    // ...and A is detached, reporting absent rather than a stale "ok".
    const a2 = await tracker.poll(workerA, "claude");
    expect(a2.snapshot).toBeUndefined();
    expect(a2.health).toBe("absent");
  });
});
