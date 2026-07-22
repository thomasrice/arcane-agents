import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedConfig, Worker } from "../../shared/types";
import type { WorkerRepository } from "../persistence/workerRepository";
import type { TmuxAdapter } from "../tmux/tmuxAdapter";
import type { PaneObservation } from "./paneObservation";
import type { WorkerSignals } from "./collectSignals";
import type { WorkerStatusDecision } from "./decide";
import { StatusMonitor } from "./statusMonitor";
import { collectSignals } from "./collectSignals";
import { decide } from "./decide";
import { claudeAdapter, genericAdapter } from "./runtimes/adapter";

vi.mock("./collectSignals", () => ({
  collectSignals: vi.fn()
}));

vi.mock("./decide", () => ({
  decide: vi.fn()
}));

interface TestRepository {
  workers: Map<string, Worker>;
  repo: WorkerRepository;
  listWorkers: ReturnType<typeof vi.fn>;
  getWorker: ReturnType<typeof vi.fn>;
  updateStatus: ReturnType<typeof vi.fn>;
  deleteWorker: ReturnType<typeof vi.fn>;
}

const testPromptSignature = {
  id: "custom-claude",
  runtime: "claude",
  all: ["^❯", "^Claude · /tmp$"]
} as const;
const testConfig = {
  status: { interactiveCommands: [], promptSignatures: [testPromptSignature], rules: [] },
  runtimes: {}
} as unknown as ResolvedConfig;

const defaultFacts: WorkerStatusDecision["facts"] = {
  command: "claude",
  commandQuietForMs: 0,
  outputQuietForMs: 0,
  workerAgeMs: 0,
  runtime: "claude",
  transcript: "ok",
  runtimePromptSignal: false,
  promptSignatureId: undefined,
  runtimeActiveSignal: false,
  hasActiveClaudeTask: false,
  hasActiveRuntimeProcess: false,
  hasLiveGenericProcess: false,
  hasRuntimeActivityText: false,
  hasParsedStrongSignal: false,
  hasParsedNeedsInput: false,
  hasParsedError: false
};

function createWorker(workerId: string, status: Worker["status"] = "idle"): Worker {
  return {
    id: workerId,
    name: workerId,
    displayName: workerId,
    projectId: "project",
    projectPath: "/tmp/project",
    runtimeId: "claude",
    runtimeLabel: "Claude",
    command: ["claude"],
    status,
    activityText: undefined,
    activityTool: undefined,
    activityPath: undefined,
    avatarType: "wizard",
    movementMode: "hold",
    position: { x: 10, y: 10 },
    tmuxRef: { session: "arcane-agents", window: workerId, pane: `%${workerId}` },
    createdAt: "2026-03-04T00:00:00.000Z",
    updatedAt: "2026-03-04T00:00:00.000Z"
  };
}

function createRepository(initialWorkers: Worker[]): TestRepository {
  const workers = new Map(initialWorkers.map((worker) => [worker.id, { ...worker }]));
  const listWorkers = vi.fn(() => [...workers.values()].map((worker) => ({ ...worker })));
  const updateStatus = vi.fn((workerId: string, update: Pick<WorkerStatusDecision, "status" | "activityText" | "activityTool" | "activityPath">) => {
    const existing = workers.get(workerId);
    if (!existing) {
      return undefined;
    }

    const updated: Worker = {
      ...existing,
      status: update.status,
      activityText: update.activityText,
      activityTool: update.activityTool,
      activityPath: update.activityPath,
      updatedAt: new Date().toISOString()
    };

    workers.set(workerId, updated);
    return { ...updated };
  });
  const getWorker = vi.fn((workerId: string) => {
    const existing = workers.get(workerId);
    return existing ? { ...existing } : undefined;
  });
  const deleteWorker = vi.fn((workerId: string) => workers.delete(workerId));

  return {
    workers,
    repo: {
      listWorkers,
      getWorker,
      updateStatus,
      deleteWorker
    } as unknown as WorkerRepository,
    listWorkers,
    getWorker,
    updateStatus,
    deleteWorker
  };
}

function createSignals(): WorkerSignals {
  return {
    currentCommand: "claude",
    commandLower: "claude",
    output: "",
    observation: {
      lastCommand: "claude",
      lastCommandChangeAtMs: Date.now(),
      lastOutputSignature: "",
      lastOutputChangeAtMs: Date.now()
    } as PaneObservation,
    transcriptSnapshot: undefined,
    parsed: {
      activity: {
        text: undefined,
        tool: undefined,
        filePath: undefined,
        needsInput: false,
        hasError: false
      }
    },
    runtime: genericAdapter,
    runtimeSignals: { prompt: false, active: false, activityText: undefined, activeTask: undefined },
    promptSignature: undefined,
    activeRuntimeProcess: undefined,
    transcriptHealth: "absent",
    interactiveCommands: new Set<string>(),
    runtimeFreshnessWindowMs: undefined,
    customStatusRule: undefined
  };
}

function createEvaluation(status: Worker["status"]): WorkerStatusDecision {
  return {
    status,
    activityText: status === "idle" || status === "stopped" ? undefined : `status-${status}`,
    activityTool: status === "idle" || status === "stopped" ? undefined : "terminal",
    activityPath: undefined,
    confidence: 0.9,
    reasons: [{ code: `status-${status}`, message: `Status ${status}` }],
    facts: defaultFacts
  };
}

function makeSignals(overrides: Partial<WorkerSignals> = {}): WorkerSignals {
  return { ...createSignals(), ...overrides };
}

function makeEvaluation(
  status: Worker["status"],
  overrides: {
    facts?: Partial<WorkerStatusDecision["facts"]>;
    reasons?: WorkerStatusDecision["reasons"];
    confidence?: number;
  } = {}
): WorkerStatusDecision {
  const base = createEvaluation(status);
  return {
    ...base,
    confidence: overrides.confidence ?? base.confidence,
    reasons: overrides.reasons ?? base.reasons,
    facts: { ...defaultFacts, ...overrides.facts }
  };
}

// A resolve-controlled barrier: each `enter()` parks until the test calls
// `releaseOne()`, so concurrency is measured structurally (how many callers are
// parked at once) rather than by racing real timers under a loaded event loop.
interface ConcurrencyGate {
  enter(): Promise<void>;
  waitForArrival(): Promise<void>;
  releaseOne(): void;
}

function createConcurrencyGate(): ConcurrencyGate {
  const parked: Array<() => void> = [];
  const arrivalWaiters: Array<() => void> = [];

  return {
    enter() {
      return new Promise<void>((resolve) => {
        parked.push(resolve);
        arrivalWaiters.shift()?.();
      });
    },
    waitForArrival() {
      if (parked.length > 0) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        arrivalWaiters.push(resolve);
      });
    },
    releaseOne() {
      parked.shift()?.();
    }
  };
}

describe("StatusMonitor", () => {
  const collectMock = vi.mocked(collectSignals);
  const decideMock = vi.mocked(decide);

  beforeEach(() => {
    vi.clearAllMocks();
    collectMock.mockResolvedValue(createSignals());
    decideMock.mockImplementation((worker) => createEvaluation(worker.status));
    delete process.env.ARCANE_AGENTS_STATUS_POLL_CONCURRENCY;
  });

  it("bounds concurrent worker evaluations at the configured concurrency", async () => {
    process.env.ARCANE_AGENTS_STATUS_POLL_CONCURRENCY = "2";

    const workerCount = 5;
    const repository = createRepository(
      Array.from({ length: workerCount }, (_unused, index) => createWorker(`worker-${index + 1}`))
    );

    const gate = createConcurrencyGate();
    let inFlight = 0;
    let maxInFlight = 0;
    const windowExists = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gate.enter();
      inFlight -= 1;
      return true;
    });
    const tmux = {
      hasManagedSession: vi.fn(async () => true),
      windowExists
    } as unknown as TmuxAdapter;

    const monitor = new StatusMonitor({
      workers: repository.repo,
      tmux,
      pollIntervalMs: 1_000,
      onWorkerUpdated: () => undefined,
      onWorkerRemoved: () => undefined,
      config: testConfig
    });

    const poll = monitor.pollOnce();

    // Admit workers one at a time. Because the semaphore holds the concurrency
    // limit, each release lets at most one more evaluation park, so max-in-flight
    // is decided by the limiter, not by how fast timers fire under load.
    for (let processed = 0; processed < workerCount; processed += 1) {
      await gate.waitForArrival();
      gate.releaseOne();
    }

    await poll;

    expect(windowExists).toHaveBeenCalledTimes(workerCount);
    expect(maxInFlight).toBe(2);
  });

  it("records a status transition, notifies, and captures poll timing metrics", async () => {
    const worker = createWorker("worker-1", "idle");
    const repository = createRepository([worker]);
    const tmux = {
      hasManagedSession: vi.fn(async () => true),
      windowExists: vi.fn(async () => true)
    } as unknown as TmuxAdapter;
    decideMock.mockImplementation(() => createEvaluation("working"));
    const onWorkerUpdated = vi.fn();
    const monitor = new StatusMonitor({
      workers: repository.repo,
      tmux,
      pollIntervalMs: 1_000,
      onWorkerUpdated,
      onWorkerRemoved: () => undefined,
      config: testConfig
    });

    await monitor.pollOnce();

    expect(onWorkerUpdated).toHaveBeenCalledWith(expect.objectContaining({ id: worker.id, status: "working" }));
    expect(repository.workers.get(worker.id)?.status).toBe("working");

    const history = monitor.getWorkerStatusHistory(worker.id);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[history.length - 1]).toMatchObject({ fromStatus: "idle", toStatus: "working" });

    const performance = monitor.getStatusPerformanceDebug();
    expect(performance.latestPoll?.workerCount).toBe(1);
    expect(performance.workers.some((timing) => timing.workerName === worker.name)).toBe(true);
  });

  it("passes precompiled configured rules and prompt signatures into pane signal collection", async () => {
    const worker = createWorker("worker-1", "idle");
    const repository = createRepository([worker]);
    const config: ResolvedConfig = {
      ...testConfig,
      status: {
        ...testConfig.status,
        rules: [
          {
            id: "configured-rule",
            match: { lastLine: "^waiting$" },
            set: { status: "idle" }
          }
        ]
      }
    };
    const monitor = new StatusMonitor({
      workers: repository.repo,
      tmux: {
        hasManagedSession: vi.fn(async () => true),
        windowExists: vi.fn(async () => true)
      } as unknown as TmuxAdapter,
      pollIntervalMs: 1_000,
      onWorkerUpdated: () => undefined,
      onWorkerRemoved: () => undefined,
      config
    });

    await monitor.pollOnce();

    expect(collectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customStatusRules: {
          rules: [expect.objectContaining({ id: "configured-rule" })],
          usesLastLine: true
        },
        promptSignatures: [
          expect.objectContaining({
            id: "custom-claude",
            runtime: "claude",
            patterns: expect.arrayContaining([expect.any(RegExp)])
          })
        ]
      })
    );
  });

  it("keeps worker records when the configured tmux session is unavailable", async () => {
    const worker = createWorker("worker-1", "idle");
    const repository = createRepository([worker]);
    const tmux = {
      hasManagedSession: vi.fn(async () => false),
      windowExists: vi.fn(async () => false)
    } as unknown as TmuxAdapter;
    const onWorkerRemoved = vi.fn();
    const monitor = new StatusMonitor({
      workers: repository.repo,
      tmux,
      pollIntervalMs: 1_000,
      onWorkerUpdated: () => undefined,
      onWorkerRemoved,
      config: testConfig
    });

    await monitor.pollOnce();

    expect(repository.workers.has(worker.id)).toBe(true);
    expect((tmux.windowExists as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(repository.deleteWorker).not.toHaveBeenCalled();
    expect(onWorkerRemoved).not.toHaveBeenCalled();
  });

  function makeMonitor(repository: TestRepository, tmux: TmuxAdapter, overrides: Partial<{
    onWorkerUpdated: (worker: Worker) => void;
    onWorkerRemoved: (workerId: string) => void;
  }> = {}): StatusMonitor {
    return new StatusMonitor({
      workers: repository.repo,
      tmux,
      pollIntervalMs: 1_000,
      onWorkerUpdated: overrides.onWorkerUpdated ?? (() => undefined),
      onWorkerRemoved: overrides.onWorkerRemoved ?? (() => undefined),
      config: testConfig
    });
  }

  function liveTmux(): TmuxAdapter {
    return {
      hasManagedSession: vi.fn(async () => true),
      windowExists: vi.fn(async () => true)
    } as unknown as TmuxAdapter;
  }

  it("captures a transition's inputs and exposes them in the fixture document", async () => {
    const worker = createWorker("worker-1", "idle");
    const repository = createRepository([worker]);

    collectMock.mockResolvedValue(
      makeSignals({
        output: "PANE-ALPHA\nrunning tests",
        currentCommand: "claude",
        runtime: claudeAdapter,
        runtimeSignals: { prompt: false, active: true, activityText: "Editing app.ts", activeTask: undefined },
        runtimeFreshnessWindowMs: 9_000
      })
    );
    decideMock.mockImplementation(() =>
      makeEvaluation("working", {
        confidence: 0.88,
        reasons: [{ code: "claude-progress-signal", message: "live progress" }],
        facts: {
          outputQuietForMs: 4_200,
          commandQuietForMs: 1_234,
          workerAgeMs: 60_000,
          runtime: "claude",
          transcript: "ok",
          runtimeActiveSignal: true
        }
      })
    );

    const monitor = makeMonitor(repository, liveTmux());
    await monitor.pollOnce();

    const result = monitor.buildStatusFixture(worker.id, { useCurrent: false, transitionIndex: undefined });
    if (!result.found) {
      throw new Error("expected worker to be found");
    }

    const doc = result.document;
    expect(doc.transitions).toBe(1);
    expect(doc.worker).toMatchObject({ id: worker.id, runtimeId: "claude" });
    expect(doc.fixture).not.toBeNull();
    expect(doc.fixture?.runtime).toBe("claude");
    expect(doc.fixture?.output).toBe("PANE-ALPHA\nrunning tests");
    expect(doc.fixture?.outputQuietForMs).toBe(4_200);
    expect(doc.fixture?.commandQuietForMs).toBe(1_234);
    expect(doc.fixture?.workerAgeMs).toBe(60_000);
    expect(doc.fixture?.priorStatus).toBe("idle");
    expect(doc.fixture?.currentCommand).toBe("claude");
    expect(doc.fixture?.runtimeFreshnessWindowMs).toBe(9_000);
    expect(doc.fixture?.promptSignatures).toEqual([testPromptSignature]);
    expect(doc.decision).toMatchObject({ status: "working", confidence: 0.88 });
    expect(doc.decision?.reasons.map((reason) => reason.code)).toContain("claude-progress-signal");
  });

  it("serves ?current=1 from the latest evaluation, empty-state for no transition, and 404 for unknown workers", async () => {
    const worker = createWorker("worker-1", "idle");
    const repository = createRepository([worker]);

    // Status never changes, so no transition is captured — but a latest-inputs slot
    // is still recorded every poll.
    collectMock.mockResolvedValue(makeSignals({ output: "CURRENT-PANE", currentCommand: "claude" }));
    decideMock.mockImplementation(() => makeEvaluation("idle"));

    const monitor = makeMonitor(repository, liveTmux());
    await monitor.pollOnce();

    const transitionView = monitor.buildStatusFixture(worker.id, { useCurrent: false, transitionIndex: undefined });
    if (!transitionView.found) {
      throw new Error("expected worker to be found");
    }
    expect(transitionView.document.transitions).toBe(0);
    expect(transitionView.document.fixture).toBeNull();
    expect(transitionView.document.decision).toBeNull();

    const currentView = monitor.buildStatusFixture(worker.id, { useCurrent: true, transitionIndex: undefined });
    if (!currentView.found) {
      throw new Error("expected worker to be found");
    }
    expect(currentView.document.fixture?.output).toBe("CURRENT-PANE");
    expect(currentView.document.fixture?.priorStatus).toBe("idle");

    const unknown = monitor.buildStatusFixture("does-not-exist", { useCurrent: false, transitionIndex: undefined });
    expect(unknown.found).toBe(false);
  });

  it("caps the transition capture ring at 5 and evicts the oldest", async () => {
    const worker = createWorker("worker-1", "idle");
    const repository = createRepository([worker]);

    const outputs = ["PANE-1", "PANE-2", "PANE-3", "PANE-4", "PANE-5", "PANE-6"];
    let pollIdx = 0;
    collectMock.mockImplementation(async () => makeSignals({ output: outputs[pollIdx] ?? "PANE-END" }));
    decideMock.mockImplementation((pollWorker) => {
      const next: Worker["status"] = pollWorker.status === "idle" ? "working" : "idle";
      const evaluation = makeEvaluation(next);
      pollIdx += 1;
      return evaluation;
    });

    const monitor = makeMonitor(repository, liveTmux());
    for (let poll = 0; poll < 6; poll += 1) {
      await monitor.pollOnce();
    }

    const latest = monitor.buildStatusFixture(worker.id, { useCurrent: false, transitionIndex: undefined });
    if (!latest.found) {
      throw new Error("expected worker to be found");
    }
    expect(latest.document.transitions).toBe(5);
    expect(latest.document.fixture?.output).toBe("PANE-6");

    const oldestHeld = monitor.buildStatusFixture(worker.id, { useCurrent: false, transitionIndex: 4 });
    if (!oldestHeld.found) {
      throw new Error("expected worker to be found");
    }
    // PANE-1 (the 6th-most-recent) was evicted; PANE-2 is now the oldest retained.
    expect(oldestHeld.document.fixture?.output).toBe("PANE-2");

    const outOfRange = monitor.buildStatusFixture(worker.id, { useCurrent: false, transitionIndex: 5 });
    if (!outOfRange.found) {
      throw new Error("expected worker to be found");
    }
    expect(outOfRange.document.fixture).toBeNull();
    expect(outOfRange.document.transitions).toBe(5);
  });

  it("caps the evaluation sample ring at 10 and evicts the oldest", async () => {
    const worker = createWorker("worker-1", "idle");
    const repository = createRepository([worker]);

    let pollIdx = 0;
    collectMock.mockResolvedValue(makeSignals({}));
    decideMock.mockImplementation(() => {
      const evaluation = makeEvaluation("idle", { reasons: [{ code: `poll-${pollIdx}`, message: "" }] });
      pollIdx += 1;
      return evaluation;
    });

    const monitor = makeMonitor(repository, liveTmux());
    for (let poll = 0; poll < 12; poll += 1) {
      await monitor.pollOnce();
    }

    const samples = monitor.getWorkerStatusEvaluations(worker.id);
    expect(samples.length).toBe(10);
    expect(samples[0].reasonCodes).toEqual(["poll-2"]);
    expect(samples[9].reasonCodes).toEqual(["poll-11"]);
  });

  it("clears status-debugging telemetry when the worker is removed", async () => {
    const worker = createWorker("worker-1", "idle");
    const repository = createRepository([worker]);
    const windowExists = vi.fn(async () => true);
    const tmux = {
      hasManagedSession: vi.fn(async () => true),
      windowExists
    } as unknown as TmuxAdapter;
    decideMock.mockImplementation(() => makeEvaluation("working"));
    const onWorkerRemoved = vi.fn();

    const monitor = makeMonitor(repository, tmux, { onWorkerRemoved });
    await monitor.pollOnce();

    expect(monitor.getWorkerStatusEvaluations(worker.id).length).toBeGreaterThan(0);
    expect(monitor.getWorkerStatusHistory(worker.id).length).toBeGreaterThan(0);
    expect(monitor.buildStatusFixture(worker.id, { useCurrent: false, transitionIndex: undefined }).found).toBe(true);

    windowExists.mockResolvedValue(false);
    await monitor.pollOnce();

    expect(onWorkerRemoved).toHaveBeenCalledWith(worker.id);
    expect(monitor.getWorkerStatusEvaluations(worker.id)).toEqual([]);
    expect(monitor.getWorkerStatusHistory(worker.id)).toEqual([]);
    expect(monitor.buildStatusFixture(worker.id, { useCurrent: false, transitionIndex: undefined }).found).toBe(false);
  });

  it("counts only transitions within the last hour in the flap summary", async () => {
    vi.useFakeTimers();
    try {
      const startMs = Date.UTC(2026, 6, 18, 0, 0, 0);
      vi.setSystemTime(startMs);

      const worker = createWorker("worker-1", "idle");
      const repository = createRepository([worker]);
      decideMock.mockImplementation((pollWorker) =>
        makeEvaluation(pollWorker.status === "idle" ? "working" : "idle")
      );

      const monitor = makeMonitor(repository, liveTmux());

      await monitor.pollOnce(); // transition recorded at startMs (2h ago at read time)
      vi.setSystemTime(startMs + 2 * 60 * 60 * 1_000);
      await monitor.pollOnce(); // transition at +2h
      vi.setSystemTime(startMs + 2 * 60 * 60 * 1_000 + 10 * 60 * 1_000);
      await monitor.pollOnce(); // transition at +2h10m

      const entry = monitor.listWorkerStatusDebug().find((row) => row.workerId === worker.id);
      // Read time is +2h10m: only the +2h and +2h10m transitions fall inside the 1h
      // window; the startMs transition is excluded.
      expect(entry?.transitionsLastHour).toBe(2);
      // Full transition history is unbounded within its own cap, so all three remain.
      expect(monitor.getWorkerStatusHistory(worker.id).length).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
