import { nanoid } from "nanoid";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  AvatarType,
  MovementMode,
  ProjectConfig,
  ResolvedConfig,
  RuntimeConfig,
  Worker,
  WorkerPosition,
  WorkerSpawnInput
} from "../../shared/types";
import { WorkerRepository } from "../persistence/workerRepository";
import { TmuxAdapter, type ManagedWindow } from "../tmux/tmuxAdapter";

interface SpawnPlan {
  projectId: string;
  project: ProjectConfig;
  runtimeId: string;
  runtime: RuntimeConfig;
  command: string[];
  displayName?: string;
  profileId?: string;
  avatar?: AvatarType;
}

interface SpawnAreaSpec {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface OutpostMapSpec {
  tileSize: number;
  spawnArea?: SpawnAreaSpec;
}

const allWorkerAvatars: AvatarType[] = [
  "knight",
  "wizard",
  "enchantress",
  "berserker",
  "druid",
  "rogue",
  "priestess",
  "elf-ranger",
  "minotaur"
];

const outpostSpawnSpec = loadOutpostSpawnSpec();
const spawnSeparationDistancePx = 52;

export class OrchestratorService {
  private readonly spawnAvatarPool: AvatarType[];
  private readonly configuredProjects: Record<string, ProjectConfig>;
  private discoveredProjects: Record<string, ProjectConfig> = {};
  private config: ResolvedConfig;

  constructor(
    initialConfig: ResolvedConfig,
    private readonly workers: WorkerRepository,
    private readonly tmux: TmuxAdapter
  ) {
    this.config = initialConfig;
    this.spawnAvatarPool = resolveSpawnAvatarPool();
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

  getDiscoveredProjects(): Record<string, ProjectConfig> {
    return { ...this.discoveredProjects };
  }

  listWorkers(): Worker[] {
    return this.workers.listWorkers();
  }

  getWorker(workerId: string): Worker | undefined {
    return this.workers.getWorker(workerId);
  }

  async spawn(input: WorkerSpawnInput): Promise<Worker> {
    const plan = this.resolveSpawnPlan(input);
    const workerId = nanoid(8).toLowerCase();
    const launchCommand = withClaudeSessionId(plan.runtimeId, plan.command);
    const shortId = workerId.slice(0, 4);
    const windowName = this.makeWindowName(plan.project.shortName, plan.runtimeId, shortId);
    const tmuxRef = await this.tmux.spawnWorker({
      workerId,
      windowName,
      projectPath: plan.project.path,
      command: launchCommand,
      projectId: plan.projectId,
      runtimeId: plan.runtimeId,
      runtimeLabel: plan.runtime.label
    });

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
      profileId: plan.profileId,
      status: "idle",
      avatarType: this.nextAvatar(plan.avatar),
      movementMode: "wander",
      position: this.nextSpawnPosition(),
      tmuxRef,
      createdAt: now,
      updatedAt: now
    };

    this.workers.saveWorker(worker);
    return worker;
  }

  async stop(workerId: string): Promise<string> {
    const worker = this.requireWorker(workerId);
    await this.tmux.stop(worker.tmuxRef).catch(() => undefined);
    this.workers.deleteWorker(workerId);
    return workerId;
  }

  async restart(workerId: string): Promise<Worker> {
    const worker = this.requireWorker(workerId);
    await this.tmux.stop(worker.tmuxRef).catch(() => undefined);

    const project = this.config.projects[worker.projectId];
    if (!project) {
      throw new Error(`Cannot restart worker '${workerId}': project '${worker.projectId}' is no longer configured.`);
    }

    const runtime = this.config.runtimes[worker.runtimeId];
    if (!runtime) {
      throw new Error(`Cannot restart worker '${workerId}': runtime '${worker.runtimeId}' is no longer configured.`);
    }

    const launchCommand = withClaudeSessionId(worker.runtimeId, worker.command);
    const shortId = worker.id.slice(0, 4);
    const windowName = this.makeWindowName(project.shortName, worker.runtimeId, shortId);
    const tmuxRef = await this.tmux.spawnWorker({
      workerId: worker.id,
      windowName,
      projectPath: project.path,
      command: launchCommand,
      projectId: worker.projectId,
      runtimeId: worker.runtimeId,
      runtimeLabel: runtime.label
    });

    const updated: Worker = {
      ...worker,
      name: windowName,
        projectPath: project.path,
        runtimeLabel: runtime.label,
        status: "idle",
        activityText: undefined,
        activityTool: undefined,
        activityPath: undefined,
        command: launchCommand,
        tmuxRef,
        updatedAt: new Date().toISOString()
      };

    this.workers.saveWorker(updated);
    return updated;
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

  async remove(workerId: string): Promise<boolean> {
    const worker = this.workers.getWorker(workerId);
    if (!worker) {
      return false;
    }

    if (worker.status !== "stopped") {
      await this.tmux.stop(worker.tmuxRef).catch(() => undefined);
    }

    return this.workers.deleteWorker(workerId);
  }

  async openInExternalTerminal(workerId: string): Promise<void> {
    const worker = this.requireWorker(workerId);
    await this.tmux.openInExternalTerminal(worker.tmuxRef, worker.id);
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

  private resolveSpawnPlan(input: WorkerSpawnInput): SpawnPlan {
    if ("shortcutIndex" in input) {
      const shortcut = this.config.shortcuts[input.shortcutIndex];
      if (!shortcut) {
        throw new Error(`Shortcut index '${input.shortcutIndex}' is out of range.`);
      }

      const project = this.config.projects[shortcut.project];
      const runtime = this.config.runtimes[shortcut.runtime];
      if (!project) {
        throw new Error(`Shortcut '${shortcut.label}' references unknown project '${shortcut.project}'.`);
      }
      if (!runtime) {
        throw new Error(`Shortcut '${shortcut.label}' references unknown runtime '${shortcut.runtime}'.`);
      }

      return {
        projectId: shortcut.project,
        project,
        runtimeId: shortcut.runtime,
        runtime,
        command: runtime.command,
        displayName: shortcut.label,
        avatar: shortcut.avatar
      };
    }

    if ("profileId" in input) {
      const profile = this.config.profiles[input.profileId];
      if (!profile) {
        throw new Error(`Profile '${input.profileId}' is not defined.`);
      }

      const project = this.config.projects[profile.project];
      const runtime = this.config.runtimes[profile.runtime];
      if (!project) {
        throw new Error(`Profile '${input.profileId}' references unknown project '${profile.project}'.`);
      }
      if (!runtime) {
        throw new Error(`Profile '${input.profileId}' references unknown runtime '${profile.runtime}'.`);
      }

      return {
        projectId: profile.project,
        project,
        runtimeId: profile.runtime,
        runtime,
        command: profile.command ?? runtime.command,
        displayName: profile.label,
        profileId: input.profileId,
        avatar: profile.avatar
      };
    }

    const project = this.config.projects[input.projectId];
    const runtime = this.config.runtimes[input.runtimeId];
    if (!project) {
      throw new Error(`Unknown project '${input.projectId}'.`);
    }
    if (!runtime) {
      throw new Error(`Unknown runtime '${input.runtimeId}'.`);
    }

    return {
      projectId: input.projectId,
      project,
      runtimeId: input.runtimeId,
      runtime,
      command: input.command && input.command.length > 0 ? input.command : runtime.command
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

  private makeWindowName(projectShortName: string, runtimeId: string, shortId: string): string {
    const sanitize = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    return `${sanitize(projectShortName)}-${sanitize(runtimeId)}-${sanitize(shortId)}`;
  }

  private nextAvatar(preferred?: AvatarType): AvatarType {
    if (preferred && this.spawnAvatarPool.includes(preferred)) {
      return preferred;
    }

    const pool = this.spawnAvatarPool.length > 0 ? this.spawnAvatarPool : allWorkerAvatars;
    const activeAvatars = new Set(
      this.workers
        .listWorkers()
        .filter((worker) => worker.status !== "stopped")
        .map((worker) => worker.avatarType)
    );

    const unusedAvatars = pool.filter((avatarType) => !activeAvatars.has(avatarType));
    const selectionPool = unusedAvatars.length > 0 ? unusedAvatars : pool;

    return selectionPool[Math.floor(Math.random() * selectionPool.length)] ?? "knight";
  }

  private nextSpawnPosition(): WorkerPosition {
    const activeWorkers = this.workers.listWorkers().filter((worker) => worker.status !== "stopped");
    const index = activeWorkers.length;

    if (outpostSpawnSpec?.spawnArea) {
      const { tileSize, spawnArea } = outpostSpawnSpec;
      const areaWidth = Math.max(1, spawnArea.x2 - spawnArea.x1 + 1);
      const areaHeight = Math.max(1, spawnArea.y2 - spawnArea.y1 + 1);
      const totalTiles = areaWidth * areaHeight;
      const startTileIndex = index % totalTiles;

      for (let step = 0; step < totalTiles; step += 1) {
        const tileIndex = (startTileIndex + step) % totalTiles;
        const tileOffsetX = tileIndex % areaWidth;
        const tileOffsetY = Math.floor(tileIndex / areaWidth);
        const tileX = spawnArea.x1 + tileOffsetX;
        const tileY = spawnArea.y1 + tileOffsetY;
        const candidate = {
          x: (tileX + 0.5) * tileSize,
          y: (tileY + 0.5) * tileSize
        };

        if (isSpawnPositionFree(candidate, activeWorkers, spawnSeparationDistancePx)) {
          return candidate;
        }
      }

      const fallbackOffsetX = startTileIndex % areaWidth;
      const fallbackOffsetY = Math.floor(startTileIndex / areaWidth);
      return {
        x: (spawnArea.x1 + fallbackOffsetX + 0.5) * tileSize,
        y: (spawnArea.y1 + fallbackOffsetY + 0.5) * tileSize
      };
    }

    const ringSize = 6;
    const ring = Math.floor(index / ringSize);
    const angle = (index % ringSize) * ((Math.PI * 2) / ringSize);
    const radius = 110 + ring * 85;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const adjustedRadius = radius + attempt * 36;
      const adjustedAngle = angle + attempt * 0.32;
      const candidate = {
        x: 520 + Math.cos(adjustedAngle) * adjustedRadius,
        y: 310 + Math.sin(adjustedAngle) * adjustedRadius
      };

      if (isSpawnPositionFree(candidate, activeWorkers, spawnSeparationDistancePx)) {
        return candidate;
      }
    }

    return {
      x: 520 + Math.cos(angle) * radius,
      y: 310 + Math.sin(angle) * radius
    };
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

function resolveSpawnAvatarPool(): AvatarType[] {
  const assetsRoot = path.resolve(process.cwd(), "assets/characters");
  return allWorkerAvatars.filter((avatarType) => {
    return fs.existsSync(path.join(assetsRoot, avatarType, "rotations", "south.png"));
  });
}

function loadOutpostSpawnSpec(): OutpostMapSpec | undefined {
  const mapPath = path.resolve(process.cwd(), "assets/maps/outpost.json");
  if (!fs.existsSync(mapPath)) {
    return undefined;
  }

  try {
    const raw = fs.readFileSync(mapPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<OutpostMapSpec>;
    if (typeof parsed.tileSize !== "number") {
      return undefined;
    }

    return {
      tileSize: parsed.tileSize,
      spawnArea: parsed.spawnArea
    };
  } catch {
    return undefined;
  }
}

function withClaudeSessionId(runtimeId: string, command: string[]): string[] {
  const commandCopy = [...command];
  if (!looksLikeClaudeRuntime(runtimeId, commandCopy)) {
    return commandCopy;
  }

  if (hasSessionIdArg(commandCopy)) {
    return commandCopy;
  }

  return [...commandCopy, "--session-id", randomUUID()];
}

function isSpawnPositionFree(candidate: WorkerPosition, workers: Worker[], minDistance: number): boolean {
  return workers.every((worker) => {
    return Math.hypot(candidate.x - worker.position.x, candidate.y - worker.position.y) >= minDistance;
  });
}

function looksLikeClaudeRuntime(runtimeId: string, command: string[]): boolean {
  if (runtimeId.toLowerCase().includes("claude")) {
    return true;
  }

  const binary = path.basename(command[0] ?? "").toLowerCase();
  return binary.includes("claude");
}

function hasSessionIdArg(command: string[]): boolean {
  for (let index = 0; index < command.length; index += 1) {
    const token = command[index] ?? "";
    if (token === "--session-id") {
      const nextValue = command[index + 1];
      return typeof nextValue === "string" && nextValue.trim().length > 0;
    }

    if (token.startsWith("--session-id=")) {
      const value = token.slice("--session-id=".length).trim();
      return value.length > 0;
    }
  }

  return false;
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/(^-|-$)/g, "");
  return slug || "project";
}

function isSameWorkerRecord(a: Worker, b: Worker): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.projectId === b.projectId &&
    a.projectPath === b.projectPath &&
    a.runtimeId === b.runtimeId &&
    a.runtimeLabel === b.runtimeLabel &&
    JSON.stringify(a.command) === JSON.stringify(b.command) &&
    a.status === b.status &&
    a.movementMode === b.movementMode &&
    a.tmuxRef.session === b.tmuxRef.session &&
    a.tmuxRef.window === b.tmuxRef.window &&
    a.tmuxRef.pane === b.tmuxRef.pane
  );
}
