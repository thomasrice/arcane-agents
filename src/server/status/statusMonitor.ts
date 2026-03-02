import type { Worker } from "../../shared/types";
import { WorkerRepository } from "../persistence/workerRepository";
import { TmuxAdapter } from "../tmux/tmuxAdapter";
import type { PaneObservation } from "./paneObservation";
import { ClaudeTranscriptTracker } from "./claudeTranscriptTracker";
import {
  collectWorkerStatusSignals,
  evaluateWorkerStatusSignals,
  normalizeWorkerStatusEvaluation,
  type WorkerStatusEvaluation
} from "./statusPipeline";

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

    let evaluation: WorkerStatusEvaluation = {
      status: worker.status,
      activityText: worker.activityText,
      activityTool: worker.activityTool,
      activityPath: worker.activityPath
    };

    try {
      const signals = await collectWorkerStatusSignals({
        worker,
        tmux: this.tmux,
        paneObservation: this.paneObservation,
        claudeTranscript: this.claudeTranscript
      });

      if (!signals) {
        const removed = this.workers.deleteWorker(worker.id);
        if (removed) {
          this.claudeTranscript.forget(worker.id);
          this.paneObservation.delete(worker.id);
          this.onWorkerRemoved(worker.id);
        }
        return;
      }

      evaluation = normalizeWorkerStatusEvaluation(evaluateWorkerStatusSignals(worker, signals));
    } catch {
      evaluation = {
        status: "error",
        activityText: "Status check failed",
        activityTool: "unknown",
        activityPath: undefined
      };
    }

    if (
      evaluation.status === worker.status &&
      evaluation.activityText === worker.activityText &&
      evaluation.activityTool === worker.activityTool &&
      evaluation.activityPath === worker.activityPath
    ) {
      return;
    }

    if (evaluation.status === "stopped") {
      const removed = this.workers.deleteWorker(worker.id);
      if (removed) {
        this.claudeTranscript.forget(worker.id);
        this.paneObservation.delete(worker.id);
        this.onWorkerRemoved(worker.id);
      }
      return;
    }

    const updated = this.workers.updateStatus(worker.id, {
      status: evaluation.status,
      activityText: evaluation.activityText,
      activityTool: evaluation.activityTool,
      activityPath: evaluation.activityPath
    });
    if (updated) {
      this.onWorkerUpdated(updated);
    }
  }
}
