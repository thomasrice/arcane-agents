import { nanoid } from "nanoid";
import type {
  AvatarType,
  BroadcastInputResult,
  MovementMode,
  ProjectConfig,
  ResolvedConfig,
  StopWorkerResult,
  Worker,
  WorkerPosition,
  WorkerSpawnInput
} from "../../shared/types";
import { conflictError, notFoundError } from "../http/appError";
import { listAvailableAvatarTypes } from "../assets/avatarCatalog";
import { WorkerRepository } from "../persistence/workerRepository";
import { buildLiveWindowLookups, findLiveMatch, planReconciliation } from "./reconcile/planReconciliation";
import { withClaudeSessionId } from "./spawn/command";
import { resolveSpawnPlan } from "./spawn/resolveSpawnPlan";
import { selectNextAvatar } from "./spawn/avatarAllocator";
import { makeWindowName as buildWindowName } from "./spawn/windowName";
import { loadOutpostSpawnSpec, nextSpawnPosition as computeNextSpawnPosition } from "./spawn/spawnPosition";
import { TmuxAdapter, type ManagedWindow } from "../tmux/tmuxAdapter";

interface BroadcastInputOptions {
  submit?: boolean;
}

const outpostSpawnSpec = loadOutpostSpawnSpec();
const spawnSeparationDistancePx = 52;

export class OrchestratorService {
  private readonly configuredProjects: Record<string, ProjectConfig>;
  private discoveredProjects: Record<string, ProjectConfig> = {};
  private config: ResolvedConfig;

  constructor(
    initialConfig: ResolvedConfig,
    private readonly workers: WorkerRepository,
    private readonly tmux: TmuxAdapter
  ) {
    this.config = initialConfig;
    this.configuredProjects = { ...initialConfig.projects };
  }

  getConfig(): ResolvedConfig {
    return this.config;
  }

  setDiscoveredProjects(nextDiscovered: Record<string, ProjectConfig>): ResolvedConfig {
    this.discoveredProjects = { ...nextDiscovered };
    this.refreshConfigProjects();
    return this.config;
  }

  listWorkers(): Worker[] {
    return this.workers.listWorkers();
  }

  getWorker(workerId: string): Worker | undefined {
    return this.workers.getWorker(workerId);
  }

  async spawn(input: WorkerSpawnInput): Promise<Worker> {
    const plan = resolveSpawnPlan(this.config, input);
    const workerId = nanoid(8).toLowerCase();
    const launchCommand = withClaudeSessionId(plan.runtimeId, plan.command);
    const shortId = workerId.slice(0, 4);
    const windowName = buildWindowName(plan.project.shortName, plan.runtimeId, shortId);
    const tmuxRef = await this.tmux.spawnWorker({
      workerId,
      windowName,
      projectPath: plan.project.path,
      command: launchCommand,
      projectId: plan.projectId,
      runtimeId: plan.runtimeId,
      runtimeLabel: plan.runtime.label
    });

    const currentWorkers = this.workers.listWorkers();
    const spawnAnchorWorkers = this.resolveSpawnAnchorWorkers(input.spawnNearWorkerIds, currentWorkers);
    const now = new Date().toISOString();
    const worker: Worker = {
      id: workerId,
      name: windowName,
      displayName: deduplicateDisplayName(plan.displayName, currentWorkers),
      projectId: plan.projectId,
      projectPath: plan.project.path,
      runtimeId: plan.runtimeId,
      runtimeLabel: plan.runtime.label,
      command: launchCommand,
      status: "idle",
      avatarType: this.nextAvatar(plan.avatar, currentWorkers),
      movementMode: "hold",
      silenced: false,
      position: this.nextSpawnPosition(currentWorkers, spawnAnchorWorkers),
      tmuxRef,
      createdAt: now,
      updatedAt: now
    };

    this.workers.saveWorker(worker);
    return worker;
  }

  async stop(workerId: string): Promise<StopWorkerResult> {
    const worker = this.workers.getWorker(workerId);
    if (!worker) {
      return {
        workerId,
        removed: false,
        alreadyStopped: true
      };
    }

    try {
      await this.tmux.stop(worker.tmuxRef);
    } catch {
      throw conflictError(`Failed to stop agent '${workerId}'.`, "worker_stop_failed");
    }

    const removed = this.workers.deleteWorker(workerId);
    return {
      workerId,
      removed,
      alreadyStopped: !removed
    };
  }

  async restart(workerId: string): Promise<Worker> {
    const worker = this.requireWorker(workerId);

    try {
      await this.tmux.stop(worker.tmuxRef);
      const tmuxRef = await this.tmux.spawnWorker({
        workerId: worker.id,
        windowName: worker.name,
        projectPath: worker.projectPath,
        command: worker.command,
        projectId: worker.projectId,
        runtimeId: worker.runtimeId,
        runtimeLabel: worker.runtimeLabel
      });

      const restarted: Worker = {
        ...worker,
        status: "idle",
        activityText: undefined,
        activityTool: undefined,
        activityPath: undefined,
        tmuxRef,
        updatedAt: new Date().toISOString()
      };

      this.workers.saveWorker(restarted);
      return restarted;
    } catch {
      throw conflictError(`Failed to restart agent '${workerId}'.`, "worker_restart_failed");
    }
  }

  updatePosition(workerId: string, position: WorkerPosition): Worker {
    const updated = this.workers.updatePosition(workerId, position);
    if (!updated) {
      throw notFoundError(`Agent '${workerId}' not found.`, "worker_not_found");
    }
    return updated;
  }

  rename(workerId: string, nextDisplayName: string): Worker {
    const worker = this.requireWorker(workerId);
    const trimmed = nextDisplayName.trim();

    const updated: Worker = {
      ...worker,
      displayName: trimmed.length > 0 ? trimmed : undefined,
      updatedAt: new Date().toISOString()
    };

    this.workers.saveWorker(updated);
    return updated;
  }

  setMovementMode(workerId: string, movementMode: MovementMode): Worker {
    const updated = this.workers.updateMovementMode(workerId, movementMode);
    if (!updated) {
      throw notFoundError(`Agent '${workerId}' not found.`, "worker_not_found");
    }

    return updated;
  }

  setSilenced(workerId: string, silenced: boolean): Worker {
    const updated = this.workers.updateSilenced(workerId, silenced);
    if (!updated) {
      throw notFoundError(`Agent '${workerId}' not found.`, "worker_not_found");
    }

    return updated;
  }

  async openInExternalTerminal(workerId: string): Promise<void> {
    const worker = this.requireWorker(workerId);
    try {
      await this.tmux.openInExternalTerminal(worker.tmuxRef, worker.id);
    } catch (error) {
      if (error instanceof Error && error.message.includes("not available")) {
        throw conflictError(`Agent '${workerId}' is unavailable for external terminal attach.`, "worker_terminal_unavailable");
      }
      throw error;
    }
  }

  async broadcastInput(workerIds: string[], text: string, options?: BroadcastInputOptions): Promise<BroadcastInputResult> {
    const uniqueWorkerIds = Array.from(new Set(workerIds));
    const deliveredWorkerIds: string[] = [];
    const skippedWorkerIds: string[] = [];
    const failed: BroadcastInputResult["failed"] = [];

    for (const workerId of uniqueWorkerIds) {
      const worker = this.workers.getWorker(workerId);
      if (!worker || worker.status === "stopped") {
        skippedWorkerIds.push(workerId);
        continue;
      }

      try {
        await this.tmux.sendInput(worker.tmuxRef, text, {
          submit: options?.submit
        });
        deliveredWorkerIds.push(workerId);
      } catch (error) {
        failed.push({
          workerId,
          error: error instanceof Error ? error.message : "Failed to send input"
        });
      }
    }

    return {
      requestedCount: uniqueWorkerIds.length,
      deliveredWorkerIds,
      skippedWorkerIds,
      failed
    };
  }

  async reconcileWithTmux(): Promise<{ updatedWorkers: Worker[]; adoptedWorkers: Worker[]; removedWorkerIds: string[] }> {
    const persistedWorkers = this.workers.listWorkers();

    if (!(await this.tmux.hasManagedSession())) {
      return {
        updatedWorkers: [],
        adoptedWorkers: [],
        removedWorkerIds: []
      };
    }

    const liveWindows = await this.tmux.listManagedWindows();
    const directLiveWorkerIds = await this.resolveDirectlyLiveWorkerIds(persistedWorkers, liveWindows);

    const plan = planReconciliation({
      persistedWorkers,
      liveWindows,
      directLiveWorkerIds,
      configProjects: this.config.projects,
      configRuntimes: this.config.runtimes,
      sessionName: this.config.backend.tmux.sessionName,
      nowIso: new Date().toISOString(),
      cwd: process.cwd(),
      generateWorkerId: () => nanoid(8).toLowerCase(),
      allocateAvatar: (existingWorkers) => this.nextAvatar(undefined, existingWorkers),
      allocatePosition: (existingWorkers) => this.nextSpawnPosition(existingWorkers)
    });

    for (const worker of plan.toSave) {
      this.workers.saveWorker(worker);
    }

    const removedWorkerIds: string[] = [];
    for (const workerId of plan.toDelete) {
      if (this.workers.deleteWorker(workerId)) {
        removedWorkerIds.push(workerId);
      }
    }

    if (Object.keys(plan.discoveredProjects).length > 0) {
      this.discoveredProjects = { ...this.discoveredProjects, ...plan.discoveredProjects };
      this.refreshConfigProjects();
    }

    return {
      updatedWorkers: plan.updatedWorkers,
      adoptedWorkers: plan.adoptedWorkers,
      removedWorkerIds
    };
  }

  // windowExists is a tmux round-trip; resolving it here (only for workers with no
  // live managed-window match) keeps planReconciliation a pure function.
  private async resolveDirectlyLiveWorkerIds(
    persistedWorkers: Worker[],
    liveWindows: ManagedWindow[]
  ): Promise<Set<string>> {
    const lookups = buildLiveWindowLookups(liveWindows);
    const directLiveWorkerIds = new Set<string>();

    for (const worker of persistedWorkers) {
      if (findLiveMatch(worker, lookups)) {
        continue;
      }

      if (await this.tmux.windowExists(worker.tmuxRef)) {
        directLiveWorkerIds.add(worker.id);
      }
    }

    return directLiveWorkerIds;
  }

  private requireWorker(workerId: string): Worker {
    const worker = this.workers.getWorker(workerId);
    if (!worker) {
      throw notFoundError(`Agent '${workerId}' not found.`, "worker_not_found");
    }
    return worker;
  }

  private nextAvatar(preferred?: AvatarType, workers?: Worker[]): AvatarType {
    return selectNextAvatar({
      preferred,
      config: this.config,
      workers: workers ?? this.workers.listWorkers(),
      availableAvatars: listAvailableAvatarTypes()
    });
  }

  private nextSpawnPosition(workers?: Worker[], anchorWorkers?: Worker[]): WorkerPosition {
    const activeWorkers = (workers ?? this.workers.listWorkers()).filter((worker) => worker.status !== "stopped");
    return computeNextSpawnPosition({
      activeWorkers,
      spec: outpostSpawnSpec,
      spawnSeparationDistancePx,
      anchorPositions: anchorWorkers?.map((worker) => worker.position)
    });
  }

  private resolveSpawnAnchorWorkers(workerIds: string[] | undefined, workers: Worker[]): Worker[] {
    if (!workerIds || workerIds.length === 0) {
      return [];
    }

    const workersById = new Map(workers.map((worker) => [worker.id, worker]));
    const anchors: Worker[] = [];

    for (const workerId of workerIds) {
      const worker = workersById.get(workerId);
      if (!worker || worker.status === "stopped") {
        continue;
      }

      anchors.push(worker);
    }

    return anchors;
  }

  private refreshConfigProjects(): void {
    this.config = {
      ...this.config,
      projects: {
        ...this.configuredProjects,
        ...this.discoveredProjects
      }
    };
  }
}

function deduplicateDisplayName(baseName: string | undefined, workers: Worker[]): string | undefined {
  if (!baseName) {
    return undefined;
  }

  const existing = new Set(
    workers
      .map((w) => w.displayName)
      .filter((n): n is string => typeof n === "string")
  );

  if (!existing.has(baseName)) {
    return baseName;
  }

  for (let n = 2; ; n += 1) {
    const candidate = `${baseName} ${n}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
}
