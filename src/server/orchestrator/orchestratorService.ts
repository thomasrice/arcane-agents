import { nanoid } from "nanoid";
import path from "node:path";
import type {
  AvatarType,
  MovementMode,
  ProjectConfig,
  ResolvedConfig,
  Worker,
  WorkerPosition,
  WorkerSpawnInput
} from "../../shared/types";
import { listAvailableAvatarTypes } from "../assets/avatarCatalog";
import { WorkerRepository } from "../persistence/workerRepository";
import { isSameWorkerRecord } from "./reconcile/isSameWorkerRecord";
import { withClaudeSessionId } from "./spawn/command";
import { resolveSpawnPlan } from "./spawn/resolveSpawnPlan";
import { selectNextAvatar } from "./spawn/avatarAllocator";
import { makeWindowName as buildWindowName, slugify } from "./spawn/windowName";
import { loadOutpostSpawnSpec, nextSpawnPosition as computeNextSpawnPosition } from "./spawn/spawnPosition";
import { TmuxAdapter, type ManagedWindow } from "../tmux/tmuxAdapter";

interface BroadcastInputOptions {
  submit?: boolean;
}

export interface BroadcastInputResult {
  requestedCount: number;
  deliveredWorkerIds: string[];
  skippedWorkerIds: string[];
  failed: Array<{
    workerId: string;
    error: string;
  }>;
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
      displayName: plan.displayName,
      projectId: plan.projectId,
      projectPath: plan.project.path,
      runtimeId: plan.runtimeId,
      runtimeLabel: plan.runtime.label,
      command: launchCommand,
      status: "idle",
      avatarType: this.nextAvatar(plan.avatar, currentWorkers),
      movementMode: "hold",
      position: this.nextSpawnPosition(currentWorkers, spawnAnchorWorkers),
      tmuxRef,
      createdAt: now,
      updatedAt: now
    };

    this.workers.saveWorker(worker);
    return worker;
  }

  async stop(workerId: string): Promise<string> {
    const worker = this.requireWorker(workerId);
    this.workers.deleteWorker(workerId);
    await this.tmux.stop(worker.tmuxRef, { background: true }).catch(() => undefined);
    return workerId;
  }

  updatePosition(workerId: string, position: WorkerPosition): Worker {
    const updated = this.workers.updatePosition(workerId, position);
    if (!updated) {
      throw new Error(`Worker '${workerId}' not found.`);
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
      throw new Error(`Worker '${workerId}' not found.`);
    }

    return updated;
  }

  async openInExternalTerminal(workerId: string): Promise<void> {
    const worker = this.requireWorker(workerId);
    await this.tmux.openInExternalTerminal(worker.tmuxRef, worker.id);
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
    const currentWorkers = this.workers.listWorkers();
    const updatedWorkers: Worker[] = [];
    const adoptedWorkers: Worker[] = [];
    const removedWorkerIds: string[] = [];

    const liveManagedWindows = await this.tmux.listManagedWindows();
    const liveByWorkerId = new Map<string, ManagedWindow>();
    const liveByWindow = new Map<string, ManagedWindow>();
    const consumedWindows = new Set<string>();

    for (const liveWindow of liveManagedWindows) {
      liveByWindow.set(liveWindow.window, liveWindow);
      if (liveWindow.workerId) {
        liveByWorkerId.set(liveWindow.workerId, liveWindow);
      }
    }

    for (const worker of currentWorkers) {
      const liveMatch = liveByWorkerId.get(worker.id) ?? liveByWindow.get(worker.tmuxRef.window);
      if (!liveMatch) {
        const directLive = await this.tmux.windowExists(worker.tmuxRef);
        if (directLive) {
          if (worker.status === "stopped") {
            const resumed: Worker = {
              ...worker,
              status: "idle",
              activityText: undefined,
              activityTool: undefined,
              activityPath: undefined,
              updatedAt: new Date().toISOString()
            };
            this.workers.saveWorker(resumed);
            updatedWorkers.push(resumed);
          }
          continue;
        }

        const removed = this.workers.deleteWorker(worker.id);
        if (removed) {
          removedWorkerIds.push(worker.id);
        }
        continue;
      }

      consumedWindows.add(liveMatch.window);

      const projectId = this.resolveProjectId(liveMatch, worker);
      const runtimeId = this.resolveRuntimeId(liveMatch.runtimeId, worker.runtimeId);
      const runtimeConfig = this.config.runtimes[runtimeId];

      const reconciled: Worker = {
        ...worker,
        name: liveMatch.window,
        projectId,
        projectPath: this.resolveProjectPath(liveMatch, projectId, worker.projectPath),
        runtimeId,
        runtimeLabel: liveMatch.runtimeLabel ?? runtimeConfig?.label ?? worker.runtimeLabel,
        command: worker.command,
        status: worker.status === "stopped" ? "working" : worker.status,
        tmuxRef: {
          session: this.config.backend.tmux.sessionName,
          window: liveMatch.window,
          pane: liveMatch.pane
        },
        updatedAt: new Date().toISOString()
      };

      if (!isSameWorkerRecord(worker, reconciled)) {
        this.workers.saveWorker(reconciled);
        updatedWorkers.push(reconciled);
      }
    }

    for (const liveWindow of liveManagedWindows) {
      if (consumedWindows.has(liveWindow.window)) {
        continue;
      }

      const workerId = liveWindow.workerId ?? nanoid(8).toLowerCase();
      if (this.workers.getWorker(workerId)) {
        continue;
      }

      const projectId = this.resolveProjectId(liveWindow);
      const runtimeId = this.resolveRuntimeId(liveWindow.runtimeId);
      const runtimeConfig = this.config.runtimes[runtimeId];
      const now = new Date().toISOString();

      const adopted: Worker = {
        id: workerId,
        name: liveWindow.window,
        projectId,
        projectPath: this.resolveProjectPath(liveWindow, projectId, process.cwd()),
        runtimeId,
        runtimeLabel: liveWindow.runtimeLabel ?? runtimeConfig?.label ?? runtimeId,
        command: runtimeConfig?.command ?? ["bash"],
        status: "idle",
        avatarType: this.nextAvatar(),
        movementMode: "hold",
        position: this.nextSpawnPosition(),
        tmuxRef: {
          session: this.config.backend.tmux.sessionName,
          window: liveWindow.window,
          pane: liveWindow.pane
        },
        createdAt: now,
        updatedAt: now
      };

      this.workers.saveWorker(adopted);
      adoptedWorkers.push(adopted);
    }

    return {
      updatedWorkers,
      adoptedWorkers,
      removedWorkerIds
    };
  }

  private requireWorker(workerId: string): Worker {
    const worker = this.workers.getWorker(workerId);
    if (!worker) {
      throw new Error(`Worker '${workerId}' not found.`);
    }
    return worker;
  }

  private resolveProjectId(liveWindow: ManagedWindow, currentWorker?: Worker): string {
    if (liveWindow.projectId && this.config.projects[liveWindow.projectId]) {
      return liveWindow.projectId;
    }

    if (currentWorker && this.config.projects[currentWorker.projectId]) {
      return currentWorker.projectId;
    }

    const projectPath = liveWindow.projectPath;
    if (projectPath) {
      for (const [projectId, project] of Object.entries(this.config.projects)) {
        if (project.path === projectPath) {
          return projectId;
        }
      }
    }

    const fallbackPath = projectPath ?? process.cwd();
    const basename = path.basename(fallbackPath) || "adopted";
    const baseId = slugify(liveWindow.projectId ?? basename);

    let candidate = baseId;
    let suffix = 2;
    while (this.config.projects[candidate]) {
      candidate = `${baseId}-${suffix}`;
      suffix += 1;
    }

    const discoveredProject: ProjectConfig = {
      path: fallbackPath,
      shortName: candidate.slice(0, 8),
      label: basename,
      source: "discovered"
    };

    this.discoveredProjects[candidate] = discoveredProject;
    this.refreshConfigProjects();

    return candidate;
  }

  private resolveProjectPath(liveWindow: ManagedWindow, projectId: string, fallbackPath: string): string {
    return liveWindow.projectPath ?? this.config.projects[projectId]?.path ?? fallbackPath;
  }

  private resolveRuntimeId(candidateRuntimeId?: string, fallbackRuntimeId?: string): string {
    if (candidateRuntimeId && this.config.runtimes[candidateRuntimeId]) {
      return candidateRuntimeId;
    }

    if (fallbackRuntimeId && this.config.runtimes[fallbackRuntimeId]) {
      return fallbackRuntimeId;
    }

    if (this.config.runtimes.shell) {
      return "shell";
    }

    const firstRuntimeId = Object.keys(this.config.runtimes)[0];
    return firstRuntimeId ?? "shell";
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
