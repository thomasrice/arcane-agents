import type { Worker } from "../../shared/types";
import { WorkerRepository } from "../persistence/workerRepository";
import { TmuxAdapter } from "../tmux/tmuxAdapter";
import { parseActivity } from "./activityParser";

export class StatusMonitor {
  private intervalId: NodeJS.Timeout | undefined;
  private pollInFlight = false;

  constructor(
    private readonly workers: WorkerRepository,
    private readonly tmux: TmuxAdapter,
    private readonly pollIntervalMs: number,
    private readonly onWorkerUpdated: (worker: Worker) => void
  ) {}

  start(): void {
    if (this.intervalId) {
      return;
    }

    this.intervalId = setInterval(() => {
      void this.pollOnce();
    }, this.pollIntervalMs);

    void this.pollOnce();
  }

  stop(): void {
    if (!this.intervalId) {
      return;
    }

    clearInterval(this.intervalId);
    this.intervalId = undefined;
  }

  async pollOnce(): Promise<void> {
    if (this.pollInFlight) {
      return;
    }

    this.pollInFlight = true;
    try {
      const currentWorkers = this.workers.listWorkers().filter((worker) => worker.status !== "stopped");

      for (const worker of currentWorkers) {
        await this.updateWorkerStatus(worker);
      }
    } finally {
      this.pollInFlight = false;
    }
  }

  private async updateWorkerStatus(worker: Worker): Promise<void> {
    const live = await this.tmux.windowExists(worker.tmuxRef);
    if (!live) {
      const stopped = this.workers.updateStatus(worker.id, {
        status: "stopped",
        activityText: undefined,
        activityTool: undefined,
        activityPath: undefined
      });
      if (stopped) {
        this.onWorkerUpdated(stopped);
      }
      return;
    }

    let derivedStatus = worker.status;
    let derivedActivityText = worker.activityText;
    let derivedActivityTool = worker.activityTool;
    let derivedActivityPath = worker.activityPath;

    try {
      const paneState = await this.tmux.getPaneState(worker.tmuxRef);
      const output = await this.tmux.capturePane(worker.tmuxRef, 35);
      if (paneState.isDead) {
        derivedStatus = "stopped";
        derivedActivityText = undefined;
        derivedActivityTool = undefined;
        derivedActivityPath = undefined;
      } else {
        const parsed = parseActivity(paneState.currentCommand, output);
        derivedStatus = parsed.status;
        derivedActivityText = parsed.activity.text;
        derivedActivityTool = parsed.activity.tool;
        derivedActivityPath = parsed.activity.filePath;
      }
    } catch {
      derivedStatus = "error";
      derivedActivityText = "Status check failed";
      derivedActivityTool = "unknown";
      derivedActivityPath = undefined;
    }

    if (
      derivedStatus === worker.status &&
      derivedActivityText === worker.activityText &&
      derivedActivityTool === worker.activityTool &&
      derivedActivityPath === worker.activityPath
    ) {
      return;
    }

    const updated = this.workers.updateStatus(worker.id, {
      status: derivedStatus,
      activityText: derivedActivityText,
      activityTool: derivedActivityTool,
      activityPath: derivedActivityPath
    });
    if (updated) {
      this.onWorkerUpdated(updated);
    }
  }
}
