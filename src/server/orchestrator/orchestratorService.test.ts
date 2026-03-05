import { describe, expect, it, vi } from "vitest";
import type { ResolvedConfig, Worker } from "../../shared/types";
import type { WorkerRepository } from "../persistence/workerRepository";
import type { TmuxAdapter } from "../tmux/tmuxAdapter";
import { OrchestratorService } from "./orchestratorService";

function createConfig(): ResolvedConfig {
  return {
    projects: {
      pa: { path: "/tmp/pa", shortName: "pa" }
    },
    runtimes: {
      shell: { command: ["bash"], label: "Shell" }
    },
    shortcuts: [],
    discovery: [],
    avatars: {
      disabled: []
    },
    audio: {
      enableSound: true
    },
    backend: {
      tmux: {
        sessionName: "arcane-agents",
        pollIntervalMs: 2500
      }
    },
    status: {
      interactiveCommands: []
    },
    server: {
      host: "127.0.0.1",
      port: 7600
    }
  };
}

function createWorker(): Worker {
  return {
    id: "worker-1",
    name: "worker-1",
    displayName: "Worker 1",
    projectId: "pa",
    projectPath: "/tmp/pa",
    runtimeId: "shell",
    runtimeLabel: "Shell",
    command: ["bash"],
    status: "idle",
    avatarType: "wizard",
    movementMode: "hold",
    position: { x: 100, y: 100 },
    tmuxRef: { session: "arcane-agents", window: "worker-1", pane: "%1" },
    createdAt: "2026-03-04T00:00:00.000Z",
    updatedAt: "2026-03-04T00:00:00.000Z"
  };
}

describe("OrchestratorService.stop", () => {
  it("stops tmux before removing worker and returns removal result", async () => {
    const worker = createWorker();
    const workers = {
      getWorker: vi.fn(() => worker),
      deleteWorker: vi.fn(() => true)
    } as unknown as WorkerRepository;

    const tmux = {
      stop: vi.fn(async () => undefined)
    } as unknown as TmuxAdapter;

    const service = new OrchestratorService(createConfig(), workers, tmux);
    const result = await service.stop(worker.id);

    expect(result).toEqual({
      workerId: worker.id,
      removed: true,
      alreadyStopped: false
    });
    expect((tmux.stop as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(worker.tmuxRef);
    expect((workers.deleteWorker as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(worker.id);

    const stopCallOrder = (tmux.stop as unknown as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ?? 0;
    const deleteCallOrder = (workers.deleteWorker as unknown as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ?? 0;
    expect(stopCallOrder).toBeLessThan(deleteCallOrder);
  });

  it("is idempotent when worker is already missing", async () => {
    const workers = {
      getWorker: vi.fn(() => undefined),
      deleteWorker: vi.fn(() => false)
    } as unknown as WorkerRepository;
    const tmux = {
      stop: vi.fn()
    } as unknown as TmuxAdapter;

    const service = new OrchestratorService(createConfig(), workers, tmux);
    const result = await service.stop("missing-worker");

    expect(result).toEqual({
      workerId: "missing-worker",
      removed: false,
      alreadyStopped: true
    });
    expect((tmux.stop as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((workers.deleteWorker as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("keeps worker record when tmux stop fails", async () => {
    const worker = createWorker();
    const workers = {
      getWorker: vi.fn(() => worker),
      deleteWorker: vi.fn(() => true)
    } as unknown as WorkerRepository;

    const tmux = {
      stop: vi.fn(async () => {
        throw new Error("tmux failure");
      })
    } as unknown as TmuxAdapter;

    const service = new OrchestratorService(createConfig(), workers, tmux);

    await expect(service.stop(worker.id)).rejects.toMatchObject({
      status: 409,
      code: "worker_stop_failed"
    });
    expect((workers.deleteWorker as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
