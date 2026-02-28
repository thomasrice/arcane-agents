import type { Worker, WorkerStatus } from "../../shared/types";
import { WorkerRepository } from "../persistence/workerRepository";
import { TmuxAdapter } from "../tmux/tmuxAdapter";

const shellCommands = new Set(["bash", "zsh", "fish", "sh"]);

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
      const stopped = this.workers.updateStatus(worker.id, "stopped", undefined);
      if (stopped) {
        this.onWorkerUpdated(stopped);
      }
      return;
    }

    let derivedStatus: WorkerStatus = worker.status;
    let derivedActivity = worker.activityText;

    try {
      const paneState = await this.tmux.getPaneState(worker.tmuxRef);
      const output = await this.tmux.capturePane(worker.tmuxRef, 35);
      derivedStatus = deriveStatus(paneState.currentCommand, paneState.isDead, output);
      derivedActivity = deriveActivity(output);
    } catch {
      derivedStatus = "error";
      derivedActivity = "Status check failed";
    }

    if (derivedStatus === worker.status && derivedActivity === worker.activityText) {
      return;
    }

    const updated = this.workers.updateStatus(worker.id, derivedStatus, derivedActivity);
    if (updated) {
      this.onWorkerUpdated(updated);
    }
  }
}

function deriveStatus(currentCommand: string, paneDead: boolean, output: string): WorkerStatus {
  if (paneDead) {
    return "stopped";
  }

  if (/(\[Y\/n\]|allow\?|permission|continue\?|approve)/i.test(output)) {
    return "attention";
  }

  if (/(traceback|exception|error|sigterm|command not found)/i.test(output)) {
    return "error";
  }

  if (shellCommands.has(currentCommand.toLowerCase())) {
    return "idle";
  }

  return "working";
}

function deriveActivity(output: string): string | undefined {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return undefined;
  }

  const recentToolLine = [...lines].reverse().find((line) => /(Read|Edit|Write|Bash|Grep|Glob|Task|TodoWrite|WebFetch)/.test(line));
  if (recentToolLine) {
    const match = recentToolLine.match(/(Read|Edit|Write|Bash|Grep|Glob|Task|TodoWrite|WebFetch)/);
    if (match) {
      return `Using ${match[1]}`;
    }
  }

  const fileLine = [...lines].reverse().find((line) => /[\w./-]+\.[A-Za-z0-9]+/.test(line));
  if (fileLine) {
    const fileMatch = fileLine.match(/([\w./-]+\.[A-Za-z0-9]+)/);
    if (fileMatch) {
      return `Working on ${fileMatch[1]}`;
    }
  }

  return lines[lines.length - 1];
}
