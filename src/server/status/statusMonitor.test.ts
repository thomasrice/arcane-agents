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
import { genericAdapter } from "./runtimes/adapter";

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
  updateStatus: ReturnType<typeof vi.fn>;
  deleteWorker: ReturnType<typeof vi.fn>;
}

const testConfig = { status: { interactiveCommands: [] }, runtimes: {} } as unknown as ResolvedConfig;

const defaultFacts: WorkerStatusDecision["facts"] = {
  command: "claude",
  commandQuietForMs: 0,
  outputQuietForMs: 0,
  workerAgeMs: 0,
  runtime: "claude",
  transcript: "ok",
  runtimePromptSignal: false,
  runtimeActiveSignal: false,
  hasActiveClaudeTask: false,
  hasActiveRuntimeProcess: false,
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
  const deleteWorker = vi.fn((workerId: string) => workers.delete(workerId));

  return {
    workers,
    repo: {
      listWorkers,
      updateStatus,
      deleteWorker
    } as unknown as WorkerRepository,
    listWorkers,
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
    activeRuntimeProcess: undefined,
    transcriptHealth: "absent",
    interactiveCommands: new Set<string>(),
    runtimeFreshnessWindowMs: undefined
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

describe("StatusMonitor", () => {
  const collectMock = vi.mocked(collectSignals);
  const decideMock = vi.mocked(decide);

  beforeEach(() => {
    vi.clearAllMocks();
    collectMock.mockResolvedValue(createSignals());
    decideMock.mockImplementation((worker) => createEvaluation(worker.status));
    delete process.env.ARCANE_AGENTS_STATUS_POLL_CONCURRENCY;
  });

  it("bounds concurrent worker evaluations", async () => {
    process.env.ARCANE_AGENTS_STATUS_POLL_CONCURRENCY = "2";

    const repository = createRepository([
      createWorker("worker-1"),
      createWorker("worker-2"),
      createWorker("worker-3"),
      createWorker("worker-4"),
      createWorker("worker-5")
    ]);

    let inFlight = 0;
    let maxInFlight = 0;
    const tmux = {
      hasManagedSession: vi.fn(async () => true),
      windowExists: vi.fn(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 8));
        inFlight -= 1;
        return true;
      })
    } as unknown as TmuxAdapter;

    const monitor = new StatusMonitor(repository.repo, tmux, 1_000, () => undefined, () => undefined, testConfig);
    await monitor.pollOnce();

    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBeGreaterThanOrEqual(1);
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
    const monitor = new StatusMonitor(repository.repo, tmux, 1_000, onWorkerUpdated, () => undefined, testConfig);

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

  it("keeps worker records when the configured tmux session is unavailable", async () => {
    const worker = createWorker("worker-1", "idle");
    const repository = createRepository([worker]);
    const tmux = {
      hasManagedSession: vi.fn(async () => false),
      windowExists: vi.fn(async () => false)
    } as unknown as TmuxAdapter;
    const onWorkerRemoved = vi.fn();
    const monitor = new StatusMonitor(repository.repo, tmux, 1_000, () => undefined, onWorkerRemoved, testConfig);

    await monitor.pollOnce();

    expect(repository.workers.has(worker.id)).toBe(true);
    expect((tmux.windowExists as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(repository.deleteWorker).not.toHaveBeenCalled();
    expect(onWorkerRemoved).not.toHaveBeenCalled();
  });
});
