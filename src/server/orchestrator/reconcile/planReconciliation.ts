import path from "node:path";
import type {
  AvatarType,
  ProjectConfig,
  RuntimeConfig,
  Worker,
  WorkerPosition
} from "../../../shared/types";
import type { ManagedWindow } from "../../tmux/tmuxAdapter";
import { slugify } from "../spawn/windowName";
import { isSameWorkerRecord } from "./isSameWorkerRecord";

export interface LiveWindowLookups {
  liveByWorkerId: Map<string, ManagedWindow>;
  liveByWindow: Map<string, ManagedWindow>;
}

export interface ReconciliationInput {
  persistedWorkers: Worker[];
  liveWindows: ManagedWindow[];
  // Worker ids that have no live managed-window match but whose tmux window still
  // exists directly (the service resolves this via windowExists before planning,
  // keeping the planner pure).
  directLiveWorkerIds: ReadonlySet<string>;
  configProjects: Record<string, ProjectConfig>;
  configRuntimes: Record<string, RuntimeConfig>;
  sessionName: string;
  nowIso: string;
  cwd: string;
  generateWorkerId: () => string;
  allocateAvatar: (existingWorkers: Worker[]) => AvatarType;
  allocatePosition: (existingWorkers: Worker[]) => WorkerPosition;
}

export interface ReconciliationPlan {
  // Effects for the service to apply against persistence/config.
  toSave: Worker[];
  toDelete: string[];
  discoveredProjects: Record<string, ProjectConfig>;
  // Categorised outcomes for the return contract / realtime broadcast.
  updatedWorkers: Worker[];
  adoptedWorkers: Worker[];
  removedWorkerIds: string[];
}

export function buildLiveWindowLookups(liveWindows: ManagedWindow[]): LiveWindowLookups {
  const liveByWorkerId = new Map<string, ManagedWindow>();
  const liveByWindow = new Map<string, ManagedWindow>();

  for (const liveWindow of liveWindows) {
    liveByWindow.set(liveWindow.window, liveWindow);
    if (liveWindow.workerId) {
      liveByWorkerId.set(liveWindow.workerId, liveWindow);
    }
  }

  return { liveByWorkerId, liveByWindow };
}

export function findLiveMatch(worker: Worker, lookups: LiveWindowLookups): ManagedWindow | undefined {
  return lookups.liveByWorkerId.get(worker.id) ?? lookups.liveByWindow.get(worker.tmuxRef.window);
}

// Pure reconciliation planner. Given the persisted workers, the live tmux
// windows, and injected non-deterministic inputs (ids/avatars/positions/clock),
// it decides what to save/delete/adopt and which projects were newly discovered.
// Unlike the old in-service logic, it never mutates config: discovered projects
// are *emitted* for the service to apply.
export function planReconciliation(input: ReconciliationInput): ReconciliationPlan {
  const {
    persistedWorkers,
    liveWindows,
    directLiveWorkerIds,
    configRuntimes,
    sessionName,
    nowIso,
    cwd,
    generateWorkerId,
    allocateAvatar,
    allocatePosition
  } = input;

  const lookups = buildLiveWindowLookups(liveWindows);
  const consumedWindows = new Set<string>();

  const toSave: Worker[] = [];
  const toDelete: string[] = [];
  const updatedWorkers: Worker[] = [];
  const adoptedWorkers: Worker[] = [];
  const removedWorkerIds: string[] = [];

  // Growing project lookup: seeds from config, then accumulates projects the
  // planner discovers this pass so uniqueness checks (and repeat paths) see them.
  const knownProjects: Record<string, ProjectConfig> = { ...input.configProjects };
  const discoveredProjects: Record<string, ProjectConfig> = {};

  const resolveProjectId = (liveWindow: ManagedWindow, currentWorker?: Worker): string => {
    if (liveWindow.projectId && knownProjects[liveWindow.projectId]) {
      return liveWindow.projectId;
    }

    if (currentWorker && knownProjects[currentWorker.projectId]) {
      return currentWorker.projectId;
    }

    const projectPath = liveWindow.projectPath;
    if (projectPath) {
      for (const [projectId, project] of Object.entries(knownProjects)) {
        if (project.path === projectPath) {
          return projectId;
        }
      }
    }

    const fallbackPath = projectPath ?? cwd;
    const basename = path.basename(fallbackPath) || "adopted";
    const baseId = slugify(liveWindow.projectId ?? basename);

    let candidate = baseId;
    let suffix = 2;
    while (knownProjects[candidate]) {
      candidate = `${baseId}-${suffix}`;
      suffix += 1;
    }

    const discoveredProject: ProjectConfig = {
      path: fallbackPath,
      shortName: candidate.slice(0, 8),
      label: basename,
      source: "discovered"
    };

    knownProjects[candidate] = discoveredProject;
    discoveredProjects[candidate] = discoveredProject;

    return candidate;
  };

  const resolveProjectPath = (liveWindow: ManagedWindow, projectId: string, fallbackPath: string): string => {
    return liveWindow.projectPath ?? knownProjects[projectId]?.path ?? fallbackPath;
  };

  const resolveRuntimeId = (candidateRuntimeId?: string, fallbackRuntimeId?: string): string => {
    if (candidateRuntimeId && configRuntimes[candidateRuntimeId]) {
      return candidateRuntimeId;
    }

    if (fallbackRuntimeId && configRuntimes[fallbackRuntimeId]) {
      return fallbackRuntimeId;
    }

    if (configRuntimes.shell) {
      return "shell";
    }

    const firstRuntimeId = Object.keys(configRuntimes)[0];
    return firstRuntimeId ?? "shell";
  };

  for (const worker of persistedWorkers) {
    const liveMatch = findLiveMatch(worker, lookups);
    if (!liveMatch) {
      if (directLiveWorkerIds.has(worker.id)) {
        if (worker.status === "stopped") {
          const resumed: Worker = {
            ...worker,
            status: "idle",
            activityText: undefined,
            activityTool: undefined,
            activityPath: undefined,
            updatedAt: nowIso
          };
          toSave.push(resumed);
          updatedWorkers.push(resumed);
        }
        continue;
      }

      toDelete.push(worker.id);
      removedWorkerIds.push(worker.id);
      continue;
    }

    consumedWindows.add(liveMatch.window);

    const projectId = resolveProjectId(liveMatch, worker);
    const runtimeId = resolveRuntimeId(liveMatch.runtimeId, worker.runtimeId);
    const runtimeConfig = configRuntimes[runtimeId];

    const reconciled: Worker = {
      ...worker,
      name: liveMatch.window,
      projectId,
      projectPath: resolveProjectPath(liveMatch, projectId, worker.projectPath),
      runtimeId,
      runtimeLabel: liveMatch.runtimeLabel ?? runtimeConfig?.label ?? worker.runtimeLabel,
      command: worker.command,
      status: worker.status === "stopped" ? "working" : worker.status,
      tmuxRef: {
        session: sessionName,
        window: liveMatch.window,
        pane: liveMatch.pane
      },
      updatedAt: nowIso
    };

    if (!isSameWorkerRecord(worker, reconciled)) {
      toSave.push(reconciled);
      updatedWorkers.push(reconciled);
    }
  }

  // Repo state after the first pass, used to allocate non-overlapping avatars and
  // positions for adopted workers (mirrors the service listing the repo again).
  const removedIdSet = new Set(removedWorkerIds);
  const savedById = new Map(toSave.map((worker) => [worker.id, worker]));
  const workersAfterFirstPass = persistedWorkers
    .filter((worker) => !removedIdSet.has(worker.id))
    .map((worker) => savedById.get(worker.id) ?? worker);

  const knownWorkerIds = new Set(workersAfterFirstPass.map((worker) => worker.id));

  for (const liveWindow of liveWindows) {
    if (consumedWindows.has(liveWindow.window)) {
      continue;
    }

    const workerId = liveWindow.workerId ?? generateWorkerId();
    if (knownWorkerIds.has(workerId)) {
      continue;
    }

    const projectId = resolveProjectId(liveWindow);
    const runtimeId = resolveRuntimeId(liveWindow.runtimeId);
    const runtimeConfig = configRuntimes[runtimeId];
    const existingForAllocation = [...workersAfterFirstPass, ...adoptedWorkers];

    const adopted: Worker = {
      id: workerId,
      name: liveWindow.window,
      projectId,
      projectPath: resolveProjectPath(liveWindow, projectId, cwd),
      runtimeId,
      runtimeLabel: liveWindow.runtimeLabel ?? runtimeConfig?.label ?? runtimeId,
      command: runtimeConfig?.command ?? ["bash"],
      status: "idle",
      avatarType: allocateAvatar(existingForAllocation),
      movementMode: "hold",
      silenced: false,
      position: allocatePosition(existingForAllocation),
      tmuxRef: {
        session: sessionName,
        window: liveWindow.window,
        pane: liveWindow.pane
      },
      createdAt: nowIso,
      updatedAt: nowIso
    };

    toSave.push(adopted);
    adoptedWorkers.push(adopted);
    knownWorkerIds.add(workerId);
  }

  return {
    toSave,
    toDelete,
    discoveredProjects,
    updatedWorkers,
    adoptedWorkers,
    removedWorkerIds
  };
}
