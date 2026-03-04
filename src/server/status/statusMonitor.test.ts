import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Worker } from "../../shared/types";
import type { WorkerRepository } from "../persistence/workerRepository";
import type { TmuxAdapter } from "../tmux/tmuxAdapter";
import type { PaneObservation } from "./paneObservation";
import type { WorkerStatusEvaluation, WorkerStatusSignals } from "./statusPipeline";
import { StatusMonitor } from "./statusMonitor";
import {
  collectWorkerStatusSignals,
  evaluateWorkerStatusSignals,
  normalizeWorkerStatusEvaluation
} from "./statusPipeline";

vi.mock("./statusPipeline", () => ({
  collectWorkerStatusSignals: vi.fn(),
  evaluateWorkerStatusSignals: vi.fn(),
  normalizeWorkerStatusEvaluation: vi.fn((evaluation: WorkerStatusEvaluation) => evaluation)
}));

interface TestRepository {
  workers: Map<string, Worker>;
  repo: WorkerRepository;
  listWorkers: ReturnType<typeof vi.fn>;
  updateStatus: ReturnType<typeof vi.fn>;
  deleteWorker: ReturnType<typeof vi.fn>;
}

const defaultFacts: WorkerStatusEvaluation["facts"] = {
  command: "claude",
  commandQuietForMs: 0,
  outputQuietForMs: 0,
  workerAgeMs: 0,
  isClaudeSession: true,
  isOpenCodeSession: false,
  hasOpenCodePromptSignal: false,
  hasOpenCodeActiveSignal: false,
  hasClaudeProgressSignal: false,
  hasActiveClaudeTask: false,
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
    tmuxRef: { session: "overworld", window: workerId, pane: `%${workerId}` },
    createdAt: "2026-03-04T00:00:00.000Z",
    updatedAt: "2026-03-04T00:00:00.000Z"
  };
}

function createRepository(initialWorkers: Worker[]): TestRepository {
  const workers = new Map(initialWorkers.map((worker) => [worker.id, { ...worker }]));
  const listWorkers = vi.fn(() => [...workers.values()].map((worker) => ({ ...worker })));
  const updateStatus = vi.fn((workerId: string, update: Pick<WorkerStatusEvaluation, "status" | "activityText" | "activityTool" | "activityPath">) => {
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

function createSignals(): WorkerStatusSignals {
  return {
    currentCommand: "claude",
    output: "",
    observation: {
      lastCommand: "claude",
      lastCommandChangeAtMs: Date.now(),
      lastOutputSignature: "",
      lastOutputChangeAtMs: Date.now()
    } as PaneObservation,
    transcriptSnapshot: undefined
  };
}

function createEvaluation(status: Worker["status"]): WorkerStatusEvaluation {
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
  const collectMock = vi.mocked(collectWorkerStatusSignals);
  const evaluateMock = vi.mocked(evaluateWorkerStatusSignals);
  const normalizeMock = vi.mocked(normalizeWorkerStatusEvaluation);

  beforeEach(() => {
    vi.clearAllMocks();
    collectMock.mockResolvedValue(createSignals());
    evaluateMock.mockImplementation((worker) => createEvaluation(worker.status));
    normalizeMock.mockImplementation((evaluation) => evaluation);
    delete process.env.OVERWORLD_STATUS_POLL_CONCURRENCY;
  });

  it("keeps expected status transitions including stopped removal", async () => {
    const repository = createRepository([createWorker("worker-1", "idle")]);
    const tmux = {
      windowExists: vi.fn(async () => true)
    } as unknown as TmuxAdapter;
    const onWorkerUpdated = vi.fn();
    const onWorkerRemoved = vi.fn();
    const monitor = new StatusMonitor(repository.repo, tmux, 1_000, onWorkerUpdated, onWorkerRemoved);

    const statusSequence: Worker["status"][] = ["working", "attention", "error", "idle", "stopped"];
    let nextStatusIndex = 0;
    evaluateMock.mockImplementation(() => {
      const nextStatus = statusSequence[nextStatusIndex] ?? "stopped";
      nextStatusIndex += 1;
      return createEvaluation(nextStatus);
    });

    await monitor.pollOnce();
    await monitor.pollOnce();
    await monitor.pollOnce();
    await monitor.pollOnce();

    const transitionHistory = monitor.getWorkerStatusHistory("worker-1");
    expect(transitionHistory.map((entry) => entry.toStatus)).toEqual(["working", "attention", "error", "idle"]);
    expect(onWorkerUpdated).toHaveBeenCalledTimes(4);

    await monitor.pollOnce();

    expect(repository.workers.has("worker-1")).toBe(false);
    expect(onWorkerRemoved).toHaveBeenCalledWith("worker-1");
    expect(onWorkerRemoved).toHaveBeenCalledTimes(1);
  });

  it("bounds concurrent worker evaluations", async () => {
    process.env.OVERWORLD_STATUS_POLL_CONCURRENCY = "2";

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
      windowExists: vi.fn(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 8));
        inFlight -= 1;
        return true;
      })
    } as unknown as TmuxAdapter;

    const monitor = new StatusMonitor(repository.repo, tmux, 1_000, () => undefined, () => undefined);
    await monitor.pollOnce();

    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBeGreaterThanOrEqual(1);
  });

  it("tracks per-poll and per-worker timing metrics", async () => {
    const repository = createRepository([createWorker("worker-1", "idle"), createWorker("worker-2", "working")]);
    const tmux = {
      windowExists: vi.fn(async () => true)
    } as unknown as TmuxAdapter;
    const monitor = new StatusMonitor(repository.repo, tmux, 1_000, () => undefined, () => undefined);

    evaluateMock.mockImplementation((worker) => {
      if (worker.id === "worker-1") {
        return createEvaluation("working");
      }

      return createEvaluation("stopped");
    });

    await monitor.pollOnce();

    const performance = monitor.getStatusPerformanceDebug();
    expect(performance.latestPoll).toBeDefined();
    expect(performance.latestPoll?.workerCount).toBe(2);
    expect(performance.latestPoll?.outcomeCounts.updated).toBe(1);
    expect(performance.latestPoll?.outcomeCounts.removed).toBe(1);
    expect(performance.recentPolls.length).toBe(1);
    expect(performance.workers).toHaveLength(1);
    expect(performance.workers[0]?.workerId).toBe("worker-1");
    expect(performance.workers[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });
});
