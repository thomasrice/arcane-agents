import { nanoid } from "nanoid";
import type {
  AvatarType,
  ProjectConfig,
  ResolvedConfig,
  RuntimeConfig,
  Worker,
  WorkerPosition,
  WorkerSpawnInput
} from "../../shared/types";
import { WorkerRepository } from "../persistence/workerRepository";
import { TmuxAdapter } from "../tmux/tmuxAdapter";

interface SpawnPlan {
  projectId: string;
  project: ProjectConfig;
  runtimeId: string;
  runtime: RuntimeConfig;
  command: string[];
  profileId?: string;
  avatar?: AvatarType;
}

const avatarPool: AvatarType[] = [
  "knight",
  "mage",
  "ranger",
  "druid",
  "rogue",
  "paladin",
  "orc",
  "dwarf"
];

export class OrchestratorService {
  private avatarCursor = 0;

  constructor(
    private readonly config: ResolvedConfig,
    private readonly workers: WorkerRepository,
    private readonly tmux: TmuxAdapter
  ) {
    this.avatarCursor = this.workers.listWorkers().length % avatarPool.length;
  }

  getConfig(): ResolvedConfig {
    return this.config;
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
    const shortId = workerId.slice(0, 4);
    const windowName = this.makeWindowName(plan.project.shortName, plan.runtimeId, shortId);
    const tmuxRef = await this.tmux.spawnWorker({
      workerId,
      windowName,
      projectPath: plan.project.path,
      command: plan.command
    });

    const now = new Date().toISOString();
    const worker: Worker = {
      id: workerId,
      name: windowName,
      projectId: plan.projectId,
      projectPath: plan.project.path,
      runtimeId: plan.runtimeId,
      runtimeLabel: plan.runtime.label,
      command: plan.command,
      profileId: plan.profileId,
      status: "working",
      avatarType: this.nextAvatar(plan.avatar),
      position: this.nextSpawnPosition(),
      tmuxRef,
      createdAt: now,
      updatedAt: now
    };

    this.workers.saveWorker(worker);
    return worker;
  }

  async stop(workerId: string): Promise<Worker> {
    const worker = this.requireWorker(workerId);

    if (worker.status !== "stopped") {
      await this.tmux.stop(worker.tmuxRef);
    }

    const updated: Worker = {
      ...worker,
      status: "stopped",
      activityText: undefined,
      updatedAt: new Date().toISOString()
    };

    this.workers.saveWorker(updated);
    return updated;
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

    const shortId = worker.id.slice(0, 4);
    const windowName = this.makeWindowName(project.shortName, worker.runtimeId, shortId);
    const tmuxRef = await this.tmux.spawnWorker({
      workerId: worker.id,
      windowName,
      projectPath: project.path,
      command: worker.command
    });

    const updated: Worker = {
      ...worker,
      name: windowName,
      projectPath: project.path,
      runtimeLabel: runtime.label,
      status: "working",
      activityText: undefined,
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

  async reconcileStoppedWorkers(): Promise<Worker[]> {
    const currentWorkers = this.workers.listWorkers();
    const updated: Worker[] = [];

    for (const worker of currentWorkers) {
      if (worker.status === "stopped") {
        continue;
      }

      const isLive = await this.tmux.windowExists(worker.tmuxRef);
      if (isLive) {
        continue;
      }

      const stopped: Worker = {
        ...worker,
        status: "stopped",
        activityText: undefined,
        updatedAt: new Date().toISOString()
      };
      this.workers.saveWorker(stopped);
      updated.push(stopped);
    }

    return updated;
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

  private makeWindowName(projectShortName: string, runtimeId: string, shortId: string): string {
    const sanitize = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    return `${sanitize(projectShortName)}-${sanitize(runtimeId)}-${sanitize(shortId)}`;
  }

  private nextAvatar(preferred?: AvatarType): AvatarType {
    if (preferred) {
      return preferred;
    }

    const avatar = avatarPool[this.avatarCursor % avatarPool.length];
    this.avatarCursor += 1;
    return avatar;
  }

  private nextSpawnPosition(): WorkerPosition {
    const activeWorkers = this.workers.listWorkers().filter((worker) => worker.status !== "stopped");
    const index = activeWorkers.length;
    const ringSize = 6;
    const ring = Math.floor(index / ringSize);
    const angle = (index % ringSize) * ((Math.PI * 2) / ringSize);
    const radius = 110 + ring * 85;

    return {
      x: 520 + Math.cos(angle) * radius,
      y: 310 + Math.sin(angle) * radius
    };
  }
}
