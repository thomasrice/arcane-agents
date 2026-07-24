import { describe, expect, it } from "vitest";
import type { ProjectConfig, RuntimeConfig, Worker } from "../../../shared/types";
import type { ManagedWindow } from "../../tmux/tmuxAdapter";
import { planReconciliation, type ReconciliationInput } from "./planReconciliation";

const configProjects: Record<string, ProjectConfig> = {
  pa: { path: "/tmp/pa", shortName: "pa" },
  web: { path: "/home/thomas/code/web-app", shortName: "web", label: "Web App", source: "config" }
};

const configRuntimes: Record<string, RuntimeConfig> = {
  shell: { command: ["bash"], label: "Shell" },
  claude: { command: ["claude"], label: "Claude Code" }
};

function createWorker(overrides: Partial<Worker> = {}): Worker {
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
    silenced: false,
    position: { x: 100, y: 100 },
    tmuxRef: { session: "arcane-agents", window: "worker-1", pane: "%1" },
    createdAt: "2026-03-04T00:00:00.000Z",
    updatedAt: "2026-03-04T00:00:00.000Z",
    ...overrides
  };
}

// Deterministic injected inputs so the planner is fully pure/reproducible.
function createInput(overrides: Partial<ReconciliationInput> = {}): ReconciliationInput {
  let idCounter = 0;
  return {
    persistedWorkers: [],
    liveWindows: [],
    directLiveWorkerIds: new Set<string>(),
    configProjects,
    configRuntimes,
    sessionName: "arcane-agents",
    nowIso: "2026-07-18T00:00:00.000Z",
    cwd: "/home/thomas/fallback",
    generateWorkerId: () => `generated-${(idCounter += 1)}`,
    allocateAvatar: () => "knight",
    allocatePosition: () => ({ x: 1, y: 2 }),
    ...overrides
  };
}

describe("planReconciliation", () => {
  it("skips a worker whose live managed window matches its record", () => {
    const worker = createWorker();
    const liveWindow: ManagedWindow = {
      window: worker.tmuxRef.window,
      pane: worker.tmuxRef.pane,
      workerId: worker.id,
      projectId: worker.projectId,
      runtimeId: worker.runtimeId,
      runtimeLabel: worker.runtimeLabel,
      projectPath: worker.projectPath
    };

    const plan = planReconciliation(createInput({ persistedWorkers: [worker], liveWindows: [liveWindow] }));

    expect(plan.toSave).toEqual([]);
    expect(plan.toDelete).toEqual([]);
    expect(plan.updatedWorkers).toEqual([]);
    expect(plan.adoptedWorkers).toEqual([]);
    expect(plan.removedWorkerIds).toEqual([]);
    expect(plan.discoveredProjects).toEqual({});
  });

  it("updates a worker whose live pane drifted", () => {
    const worker = createWorker();
    const liveWindow: ManagedWindow = {
      window: worker.tmuxRef.window,
      pane: "%9",
      workerId: worker.id,
      projectId: worker.projectId,
      runtimeId: worker.runtimeId,
      runtimeLabel: worker.runtimeLabel,
      projectPath: worker.projectPath
    };

    const plan = planReconciliation(createInput({ persistedWorkers: [worker], liveWindows: [liveWindow] }));

    expect(plan.updatedWorkers).toHaveLength(1);
    expect(plan.updatedWorkers[0].tmuxRef.pane).toBe("%9");
    expect(plan.toSave).toEqual(plan.updatedWorkers);
    expect(plan.adoptedWorkers).toEqual([]);
    expect(plan.removedWorkerIds).toEqual([]);
  });

  it("marks a worker with no live match for deletion", () => {
    const worker = createWorker();

    const plan = planReconciliation(
      createInput({ persistedWorkers: [worker], liveWindows: [], directLiveWorkerIds: new Set() })
    );

    expect(plan.toDelete).toEqual([worker.id]);
    expect(plan.removedWorkerIds).toEqual([worker.id]);
    expect(plan.toSave).toEqual([]);
    expect(plan.adoptedWorkers).toEqual([]);
  });

  it("resumes a stopped worker that is still directly live but unmanaged", () => {
    const worker = createWorker({ status: "stopped", silenced: true });

    const plan = planReconciliation(
      createInput({
        persistedWorkers: [worker],
        liveWindows: [],
        directLiveWorkerIds: new Set([worker.id])
      })
    );

    expect(plan.removedWorkerIds).toEqual([]);
    expect(plan.updatedWorkers).toHaveLength(1);
    expect(plan.updatedWorkers[0].status).toBe("idle");
    expect(plan.updatedWorkers[0].silenced).toBe(true);
    expect(plan.toSave).toEqual(plan.updatedWorkers);
  });

  it("adopts a config-resolved window without discovering a project", () => {
    const liveWindow: ManagedWindow = {
      window: "web-claude-a1b2",
      pane: "%4",
      workerId: "adopt-web-1",
      projectId: "web",
      runtimeId: "claude",
      runtimeLabel: "Claude Runtime",
      projectPath: "/home/thomas/code/web-app"
    };

    const plan = planReconciliation(createInput({ liveWindows: [liveWindow] }));

    expect(plan.adoptedWorkers).toHaveLength(1);
    expect(plan.adoptedWorkers[0]).toMatchObject({
      id: "adopt-web-1",
      projectId: "web",
      runtimeId: "claude",
      runtimeLabel: "Claude Runtime",
      command: ["claude"],
      avatarType: "knight",
      position: { x: 1, y: 2 },
      silenced: false,
      tmuxRef: { session: "arcane-agents", window: "web-claude-a1b2", pane: "%4" }
    });
    expect(plan.discoveredProjects).toEqual({});
    expect(plan.toSave).toEqual(plan.adoptedWorkers);
  });

  it("emits (does not mutate) a discovered project for an unknown path", () => {
    const input = createInput({
      liveWindows: [
        {
          window: "cool-project-shell-x",
          pane: "%5",
          projectPath: "/home/thomas/code/cool-project"
        }
      ]
    });
    const projectsBefore = { ...input.configProjects };

    const plan = planReconciliation(input);

    expect(plan.adoptedWorkers).toHaveLength(1);
    expect(plan.adoptedWorkers[0]).toMatchObject({
      id: "generated-1",
      projectId: "cool-project",
      runtimeId: "shell",
      command: ["bash"]
    });

    // The planner emits the discovered project instead of mutating config.
    expect(plan.discoveredProjects).toEqual({
      "cool-project": {
        path: "/home/thomas/code/cool-project",
        shortName: "cool-pro",
        label: "cool-project",
        source: "discovered"
      }
    });
    expect(input.configProjects).toEqual(projectsBefore);
  });

  it("suffixes colliding discovered project ids within a single pass", () => {
    const input = createInput({
      configProjects: {
        ...configProjects,
        // A config project already owns the id "cool-project" would collide;
        // instead use two unknown windows that slugify to the same base id.
      },
      liveWindows: [
        { window: "w1", pane: "%1", projectPath: "/a/cool-project" },
        { window: "w2", pane: "%2", projectPath: "/b/cool-project" }
      ]
    });

    const plan = planReconciliation(input);

    expect(Object.keys(plan.discoveredProjects).sort()).toEqual(["cool-project", "cool-project-2"]);
    expect(plan.adoptedWorkers.map((worker) => worker.projectId)).toEqual(["cool-project", "cool-project-2"]);
  });
});
