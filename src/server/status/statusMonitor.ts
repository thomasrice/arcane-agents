import type { Worker } from "../../shared/types";
import { WorkerRepository } from "../persistence/workerRepository";
import { TmuxAdapter } from "../tmux/tmuxAdapter";
import { observePane, type PaneObservation } from "./paneObservation";
import { ClaudeTranscriptTracker } from "./claudeTranscriptTracker";
import { evaluateWorkerStatus } from "./statusEvaluator";
import { capturePaneLineCount } from "./runtimeSignals";

export class StatusMonitor {
  private intervalId: NodeJS.Timeout | undefined;
  private pollInFlight = false;
  private readonly claudeTranscript = new ClaudeTranscriptTracker();
  private readonly paneObservation = new Map<string, PaneObservation>();

  constructor(
    private readonly workers: WorkerRepository,
    private readonly tmux: TmuxAdapter,
    private readonly pollIntervalMs: number,
    private readonly onWorkerUpdated: (worker: Worker) => void,
    private readonly onWorkerRemoved: (workerId: string) => void
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
      const currentWorkers = this.workers.listWorkers();

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
      const removed = this.workers.deleteWorker(worker.id);
      if (removed) {
        this.claudeTranscript.forget(worker.id);
        this.paneObservation.delete(worker.id);
        this.onWorkerRemoved(worker.id);
      }
      return;
    }

    let derivedStatus = worker.status;
    let derivedActivityText = worker.activityText;
    let derivedActivityTool = worker.activityTool;
    let derivedActivityPath = worker.activityPath;

    try {
      const paneState = await this.tmux.getPaneState(worker.tmuxRef);
      const output = await this.tmux.capturePane(worker.tmuxRef, capturePaneLineCount(worker, paneState.currentCommand.toLowerCase()));
      if (paneState.isDead) {
        const removed = this.workers.deleteWorker(worker.id);
        if (removed) {
          this.claudeTranscript.forget(worker.id);
          this.paneObservation.delete(worker.id);
          this.onWorkerRemoved(worker.id);
        }
        return;
      }

      const transcriptSnapshot = this.claudeTranscript.poll(worker, paneState.currentCommand, paneState.currentPath);
      const observation = observePane(this.paneObservation, worker.id, paneState.currentCommand, output);
      const evaluated = evaluateWorkerStatus({
        worker,
        currentCommand: paneState.currentCommand,
        output,
        observation,
        transcriptSnapshot
      });

      derivedStatus = evaluated.status;
      derivedActivityText = evaluated.activityText;
      derivedActivityTool = evaluated.activityTool;
      derivedActivityPath = evaluated.activityPath;
    } catch {
      derivedStatus = "error";
      derivedActivityText = "Status check failed";
      derivedActivityTool = "unknown";
      derivedActivityPath = undefined;
    }

    if (derivedStatus === "idle") {
      derivedActivityText = undefined;
      derivedActivityTool = undefined;
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

    if (derivedStatus === "stopped") {
      const removed = this.workers.deleteWorker(worker.id);
      if (removed) {
        this.claudeTranscript.forget(worker.id);
        this.paneObservation.delete(worker.id);
        this.onWorkerRemoved(worker.id);
      }
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
