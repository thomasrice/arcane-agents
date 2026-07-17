import { describe, expect, it, vi } from "vitest";
import type { ResolvedConfig, Worker } from "../../shared/types";
import type { WorkerRepository } from "../persistence/workerRepository";
import type { ManagedWindow, TmuxAdapter } from "../tmux/tmuxAdapter";
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
    keybindings: {
      leaveTerminalFocus: ["Ctrl+Alt+]"]
    },
    avatars: {
      disabled: []
    },
    audio: {
      enableSound: true
    },
    backend: {
      tmux: {
        socketName: "arcane-agents",
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

// A config that also knows a second project ("web") and runtime ("claude") so
// adoption of a fully-tagged window can be shown to resolve straight from config
// (no discovered-project fallback).
function createRichConfig(): ResolvedConfig {
  const base = createConfig();
  return {
    ...base,
    projects: {
      ...base.projects,
      web: { path: "/home/thomas/code/web-app", shortName: "web", label: "Web App", source: "config" }
    },
    runtimes: {
      ...base.runtimes,
      claude: { command: ["claude"], label: "Claude Code" }
    }
  };
}

interface FakeRepository {
  repo: WorkerRepository;
  store: Map<string, Worker>;
  saveWorker: ReturnType<typeof vi.fn>;
  deleteWorker: ReturnType<typeof vi.fn>;
}

// Stateful in-memory stand-in for the persistence boundary: mutations land in a
// real Map so tests can assert what ended up saved/deleted rather than which
// methods were called with which structs.
function createRepository(initial: Worker[] = []): FakeRepository {
  const store = new Map<string, Worker>();
  for (const worker of initial) {
    store.set(worker.id, worker);
  }

  const saveWorker = vi.fn((worker: Worker) => {
    store.set(worker.id, worker);
  });
  const deleteWorker = vi.fn((workerId: string) => store.delete(workerId));

  const repo = {
    listWorkers: vi.fn(() => Array.from(store.values())),
    getWorker: vi.fn((workerId: string) => store.get(workerId)),
    saveWorker,
    deleteWorker
  } as unknown as WorkerRepository;

  return { repo, store, saveWorker, deleteWorker };
}

interface FakeTmuxOptions {
  managedSession?: boolean;
  managedWindows?: ManagedWindow[];
  windowExists?: boolean;
}

// Stand-in for the tmux boundary. windowExists is only consulted for workers
// with no live managed match, so it defaults to "gone".
function createTmux(options: FakeTmuxOptions = {}): TmuxAdapter {
  return {
    hasManagedSession: vi.fn(async () => options.managedSession ?? true),
    listManagedWindows: vi.fn(async () => options.managedWindows ?? []),
    windowExists: vi.fn(async () => options.windowExists ?? false)
  } as unknown as TmuxAdapter;
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

describe("OrchestratorService.restart", () => {
  it("restarts tmux in place and preserves the worker record", async () => {
    const worker = createWorker();
    const workers = {
      getWorker: vi.fn(() => worker),
      saveWorker: vi.fn()
    } as unknown as WorkerRepository;

    const nextTmuxRef = { session: "arcane-agents", window: "worker-1", pane: "%7" };
    const tmux = {
      stop: vi.fn(async () => undefined),
      spawnWorker: vi.fn(async () => nextTmuxRef)
    } as unknown as TmuxAdapter;

    const service = new OrchestratorService(createConfig(), workers, tmux);
    const result = await service.restart(worker.id);

    expect((tmux.stop as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(worker.tmuxRef);
    expect((tmux.spawnWorker as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({
      workerId: worker.id,
      windowName: worker.name,
      projectPath: worker.projectPath,
      command: worker.command,
      projectId: worker.projectId,
      runtimeId: worker.runtimeId,
      runtimeLabel: worker.runtimeLabel
    });
    expect(result).toMatchObject({
      ...worker,
      status: "idle",
      tmuxRef: nextTmuxRef,
      activityText: undefined,
      activityTool: undefined,
      activityPath: undefined,
      updatedAt: expect.any(String)
    });
    expect((workers.saveWorker as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(result);

    const stopCallOrder = (tmux.stop as unknown as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ?? 0;
    const spawnCallOrder = (tmux.spawnWorker as unknown as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ?? 0;
    expect(stopCallOrder).toBeLessThan(spawnCallOrder);
  });

  it("surfaces a conflict when restart fails", async () => {
    const worker = createWorker();
    const workers = {
      getWorker: vi.fn(() => worker),
      saveWorker: vi.fn()
    } as unknown as WorkerRepository;
    const tmux = {
      stop: vi.fn(async () => {
        throw new Error("tmux failure");
      }),
      spawnWorker: vi.fn()
    } as unknown as TmuxAdapter;

    const service = new OrchestratorService(createConfig(), workers, tmux);

    await expect(service.restart(worker.id)).rejects.toMatchObject({
      status: 409,
      code: "worker_restart_failed"
    });
    expect((workers.saveWorker as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.reconcileWithTmux", () => {
  it("keeps persisted workers when the configured tmux session is unavailable", async () => {
    const worker = createWorker();
    const workers = {
      listWorkers: vi.fn(() => [worker]),
      deleteWorker: vi.fn()
    } as unknown as WorkerRepository;

    const tmux = {
      hasManagedSession: vi.fn(async () => false),
      listManagedWindows: vi.fn(),
      windowExists: vi.fn()
    } as unknown as TmuxAdapter;

    const service = new OrchestratorService(createConfig(), workers, tmux);
    const result = await service.reconcileWithTmux();

    expect(result).toEqual({
      updatedWorkers: [],
      adoptedWorkers: [],
      removedWorkerIds: []
    });
    expect((tmux.listManagedWindows as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((tmux.windowExists as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((workers.deleteWorker as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("removes stale workers when the tmux session is available but the worker window is gone", async () => {
    const worker = createWorker();
    const workers = {
      listWorkers: vi.fn(() => [worker]),
      deleteWorker: vi.fn(() => true)
    } as unknown as WorkerRepository;

    const tmux = {
      hasManagedSession: vi.fn(async () => true),
      listManagedWindows: vi.fn(async () => []),
      windowExists: vi.fn(async () => false)
    } as unknown as TmuxAdapter;

    const service = new OrchestratorService(createConfig(), workers, tmux);
    const result = await service.reconcileWithTmux();

    expect(result).toEqual({
      updatedWorkers: [],
      adoptedWorkers: [],
      removedWorkerIds: [worker.id]
    });
    expect((workers.deleteWorker as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(worker.id);
  });

  it("adopts a fully-tagged managed window into a persisted, config-resolved worker", async () => {
    const config = createRichConfig();
    const { repo, store, saveWorker } = createRepository([]);
    const managedWindow: ManagedWindow = {
      window: "web-claude-a1b2",
      pane: "%4",
      workerId: "adopt-web-1",
      projectId: "web",
      runtimeId: "claude",
      runtimeLabel: "Claude Runtime",
      projectPath: "/home/thomas/code/web-app"
    };
    const tmux = createTmux({ managedSession: true, managedWindows: [managedWindow] });

    const service = new OrchestratorService(config, repo, tmux);
    const result = await service.reconcileWithTmux();

    expect(result.updatedWorkers).toEqual([]);
    expect(result.removedWorkerIds).toEqual([]);
    expect(result.adoptedWorkers).toHaveLength(1);

    const adopted = result.adoptedWorkers[0];
    // Identity + project/runtime fields come straight from the window's metadata,
    // because the config already knows the "web" project and "claude" runtime.
    expect(adopted).toMatchObject({
      id: "adopt-web-1",
      name: "web-claude-a1b2",
      projectId: "web",
      projectPath: "/home/thomas/code/web-app",
      runtimeId: "claude",
      runtimeLabel: "Claude Runtime",
      command: ["claude"],
      status: "idle",
      movementMode: "hold",
      tmuxRef: { session: "arcane-agents", window: "web-claude-a1b2", pane: "%4" }
    });
    // Adoption always allocates a fresh avatar and map position; tmux metadata
    // carries neither, so only their presence/shape can be pinned.
    expect(typeof adopted.avatarType).toBe("string");
    expect(adopted.avatarType.length).toBeGreaterThan(0);
    expect(adopted.position).toEqual({ x: expect.any(Number), y: expect.any(Number) });

    // Persisted under the metadata's worker id.
    expect(saveWorker).toHaveBeenCalledTimes(1);
    expect(store.get("adopt-web-1")).toEqual(adopted);

    // A config-known project must NOT trigger the discovered-project fallback.
    expect(Object.keys(service.getConfig().projects).sort()).toEqual(["pa", "web"]);
  });

  it("adopts an untagged managed window, deriving project id from the projectPath basename", async () => {
    const config = createConfig();
    const { repo, store } = createRepository([]);
    const managedWindow: ManagedWindow = {
      window: "cool-project-shell-x",
      pane: "%5",
      // no workerId / projectId / runtimeId / runtimeLabel metadata
      projectPath: "/home/thomas/code/cool-project"
    };
    const tmux = createTmux({ managedSession: true, managedWindows: [managedWindow] });

    const service = new OrchestratorService(config, repo, tmux);
    const result = await service.reconcileWithTmux();

    expect(result.adoptedWorkers).toHaveLength(1);
    const adopted = result.adoptedWorkers[0];

    // Missing worker id -> a generated non-empty id.
    expect(typeof adopted.id).toBe("string");
    expect(adopted.id.length).toBeGreaterThan(0);

    expect(adopted).toMatchObject({
      name: "cool-project-shell-x",
      // basename("/home/thomas/code/cool-project") -> slugified -> "cool-project"
      projectId: "cool-project",
      projectPath: "/home/thomas/code/cool-project",
      // no runtime metadata + config has a "shell" runtime -> falls back to shell
      runtimeId: "shell",
      runtimeLabel: "Shell",
      command: ["bash"],
      status: "idle",
      tmuxRef: { session: "arcane-agents", window: "cool-project-shell-x", pane: "%5" }
    });

    // Persisted under the generated id.
    expect(store.get(adopted.id)).toEqual(adopted);

    // pins current behaviour — see plan.md
    // Resolving the project id for an unknown path MUTATES config: a synthetic
    // "discovered" project is registered as a side effect of the lookup.
    expect(service.getConfig().projects["cool-project"]).toEqual({
      path: "/home/thomas/code/cool-project",
      shortName: "cool-pro",
      label: "cool-project",
      source: "discovered"
    });
  });

  it("skips re-saving a worker whose live managed window matches its record", async () => {
    const worker = createWorker();
    const { repo, store, saveWorker, deleteWorker } = createRepository([worker]);
    const managedWindow: ManagedWindow = {
      window: worker.tmuxRef.window,
      pane: worker.tmuxRef.pane,
      workerId: worker.id,
      projectId: worker.projectId,
      runtimeId: worker.runtimeId,
      runtimeLabel: worker.runtimeLabel,
      projectPath: worker.projectPath
    };
    const tmux = createTmux({ managedSession: true, managedWindows: [managedWindow] });

    const service = new OrchestratorService(createConfig(), repo, tmux);
    const result = await service.reconcileWithTmux();

    // Nothing drifted, so no write and no return-payload entries.
    expect(result).toEqual({ updatedWorkers: [], adoptedWorkers: [], removedWorkerIds: [] });
    expect(saveWorker).not.toHaveBeenCalled();
    expect(deleteWorker).not.toHaveBeenCalled();
    // Record retained untouched.
    expect(store.get(worker.id)).toEqual(worker);
  });

  it("updates a worker whose live pane drifted from its record", async () => {
    const worker = createWorker();
    const { repo, store, saveWorker } = createRepository([worker]);
    const managedWindow: ManagedWindow = {
      window: worker.tmuxRef.window,
      pane: "%9", // pane moved
      workerId: worker.id,
      projectId: worker.projectId,
      runtimeId: worker.runtimeId,
      runtimeLabel: worker.runtimeLabel,
      projectPath: worker.projectPath
    };
    const tmux = createTmux({ managedSession: true, managedWindows: [managedWindow] });

    const service = new OrchestratorService(createConfig(), repo, tmux);
    const result = await service.reconcileWithTmux();

    expect(result.adoptedWorkers).toEqual([]);
    expect(result.removedWorkerIds).toEqual([]);
    expect(result.updatedWorkers).toHaveLength(1);

    const updated = result.updatedWorkers[0];
    expect(updated.id).toBe(worker.id);
    expect(updated.tmuxRef.pane).toBe("%9");
    // The persisted record reflects the drift and equals the returned record.
    expect(saveWorker).toHaveBeenCalledTimes(1);
    expect(store.get(worker.id)).toEqual(updated);
  });

  it("follows a tmux window rename when the worker id still matches", async () => {
    const worker = createWorker();
    const { repo, store } = createRepository([worker]);
    const managedWindow: ManagedWindow = {
      window: "worker-1-renamed", // window renamed in tmux
      pane: worker.tmuxRef.pane,
      workerId: worker.id, // still matched via worker id
      projectId: worker.projectId,
      runtimeId: worker.runtimeId,
      runtimeLabel: worker.runtimeLabel,
      projectPath: worker.projectPath
    };
    const tmux = createTmux({ managedSession: true, managedWindows: [managedWindow] });

    const service = new OrchestratorService(createConfig(), repo, tmux);
    const result = await service.reconcileWithTmux();

    // Renamed window is consumed by the match, so it is updated, not adopted.
    expect(result.adoptedWorkers).toEqual([]);
    expect(result.updatedWorkers).toHaveLength(1);

    const updated = result.updatedWorkers[0];
    expect(updated.id).toBe(worker.id);
    expect(updated.name).toBe("worker-1-renamed");
    expect(updated.tmuxRef.window).toBe("worker-1-renamed");
    expect(store.get(worker.id)?.name).toBe("worker-1-renamed");
  });

  it("reactivates a stopped worker that reappears as a live managed window", async () => {
    const worker: Worker = { ...createWorker(), status: "stopped" };
    const { repo, store } = createRepository([worker]);
    const managedWindow: ManagedWindow = {
      window: worker.tmuxRef.window,
      pane: worker.tmuxRef.pane,
      workerId: worker.id,
      projectId: worker.projectId,
      runtimeId: worker.runtimeId,
      runtimeLabel: worker.runtimeLabel,
      projectPath: worker.projectPath
    };
    const tmux = createTmux({ managedSession: true, managedWindows: [managedWindow] });

    const service = new OrchestratorService(createConfig(), repo, tmux);
    const result = await service.reconcileWithTmux();

    expect(result.removedWorkerIds).toEqual([]);
    expect(result.updatedWorkers).toHaveLength(1);
    // stopped -> working on a live managed match.
    expect(result.updatedWorkers[0].status).toBe("working");
    expect(store.get(worker.id)?.status).toBe("working");
  });

  it("returns the mixed {updated, adopted, removed} contract in one pass", async () => {
    const config = createRichConfig();

    const keep: Worker = {
      ...createWorker(),
      id: "keep-1",
      name: "keep-win",
      tmuxRef: { session: "arcane-agents", window: "keep-win", pane: "%1" }
    };
    const drift: Worker = {
      ...createWorker(),
      id: "drift-1",
      name: "drift-win",
      tmuxRef: { session: "arcane-agents", window: "drift-win", pane: "%2" }
    };
    const gone: Worker = {
      ...createWorker(),
      id: "gone-1",
      name: "gone-win",
      tmuxRef: { session: "arcane-agents", window: "gone-win", pane: "%3" }
    };

    const { repo, store } = createRepository([keep, drift, gone]);

    const managedWindows: ManagedWindow[] = [
      // exact match for keep -> skipped
      {
        window: "keep-win",
        pane: "%1",
        workerId: "keep-1",
        projectId: "pa",
        runtimeId: "shell",
        runtimeLabel: "Shell",
        projectPath: "/tmp/pa"
      },
      // pane drift for drift -> updated
      {
        window: "drift-win",
        pane: "%8",
        workerId: "drift-1",
        projectId: "pa",
        runtimeId: "shell",
        runtimeLabel: "Shell",
        projectPath: "/tmp/pa"
      },
      // unmatched managed window -> adopted
      {
        window: "web-adopt",
        pane: "%9",
        workerId: "adopt-1",
        projectId: "web",
        runtimeId: "claude",
        runtimeLabel: "Claude Runtime",
        projectPath: "/home/thomas/code/web-app"
      }
    ];

    // gone-1 has no managed window; windowExists=false makes it truly stale.
    const tmux = createTmux({ managedSession: true, managedWindows, windowExists: false });

    const service = new OrchestratorService(config, repo, tmux);
    const result = await service.reconcileWithTmux();

    expect(result.updatedWorkers.map((w) => w.id)).toEqual(["drift-1"]);
    expect(result.updatedWorkers[0].tmuxRef.pane).toBe("%8");

    expect(result.adoptedWorkers.map((w) => w.id)).toEqual(["adopt-1"]);
    expect(result.adoptedWorkers[0]).toMatchObject({ projectId: "web", runtimeId: "claude" });

    expect(result.removedWorkerIds).toEqual(["gone-1"]);

    // Final persisted state matches the contract.
    expect(store.has("gone-1")).toBe(false);
    expect(store.get("keep-1")).toEqual(keep); // untouched
    expect(store.get("drift-1")?.tmuxRef.pane).toBe("%8");
    expect(store.get("adopt-1")).toEqual(result.adoptedWorkers[0]);
  });
});
