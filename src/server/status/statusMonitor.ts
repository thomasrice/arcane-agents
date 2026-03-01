import type { Worker } from "../../shared/types";
import { WorkerRepository } from "../persistence/workerRepository";
import { TmuxAdapter } from "../tmux/tmuxAdapter";
import type { ParsedActivity } from "./activityParser";
import { parseActivity } from "./activityParser";
import { ClaudeTranscriptTracker } from "./claudeTranscriptTracker";

interface PaneObservation {
  lastCommand: string;
  lastCommandChangeAtMs: number;
  lastOutputSignature: string;
  lastOutputChangeAtMs: number;
}

const shellCommands = new Set(["bash", "zsh", "fish", "sh", "nu", "pwsh"]);
const nonShellIdleAfterMs = 10_000;

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
      const output = await this.tmux.capturePane(worker.tmuxRef, 35);
      if (paneState.isDead) {
        const removed = this.workers.deleteWorker(worker.id);
        if (removed) {
          this.claudeTranscript.forget(worker.id);
          this.paneObservation.delete(worker.id);
          this.onWorkerRemoved(worker.id);
        }
        return;
      } else {
        const parsed = parseActivity(paneState.currentCommand, output);
        const transcriptSnapshot = this.claudeTranscript.poll(worker, paneState.currentCommand, paneState.currentPath);
        const observation = this.observePane(worker.id, paneState.currentCommand, output);
        const activeClaudeTask = extractClaudeActiveTask(output);

        if (transcriptSnapshot) {
          derivedStatus = transcriptSnapshot.status;
          derivedActivityText = transcriptSnapshot.activityText ?? parsed.activity.text;
          derivedActivityTool = transcriptSnapshot.activityTool ?? parsed.activity.tool;
          derivedActivityPath = transcriptSnapshot.activityPath ?? parsed.activity.filePath;

          if (derivedStatus === "idle" && activeClaudeTask) {
            derivedStatus = "working";
            derivedActivityText = activeClaudeTask;
            derivedActivityTool = "terminal";
            derivedActivityPath = undefined;
          }
        } else {
          derivedStatus = this.resolveFallbackStatus(parsed.status, paneState.currentCommand, observation, parsed.activity);
          if (derivedStatus === "idle" && activeClaudeTask) {
            derivedStatus = "working";
            derivedActivityText = activeClaudeTask;
            derivedActivityTool = "terminal";
            derivedActivityPath = undefined;
          }

          if (derivedStatus === "idle") {
            derivedActivityText = undefined;
            derivedActivityTool = undefined;
            derivedActivityPath = undefined;
          } else {
            derivedActivityText = parsed.activity.text;
            derivedActivityTool = parsed.activity.tool;
            derivedActivityPath = parsed.activity.filePath;
          }
        }
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

  private observePane(workerId: string, currentCommand: string, output: string): PaneObservation {
    const now = Date.now();
    const signature = outputSignature(output);
    const existing = this.paneObservation.get(workerId);

    if (!existing) {
      const initial: PaneObservation = {
        lastCommand: currentCommand,
        lastCommandChangeAtMs: now,
        lastOutputSignature: signature,
        lastOutputChangeAtMs: now
      };
      this.paneObservation.set(workerId, initial);
      return initial;
    }

    if (existing.lastCommand !== currentCommand) {
      existing.lastCommand = currentCommand;
      existing.lastCommandChangeAtMs = now;
    }

    if (existing.lastOutputSignature !== signature) {
      existing.lastOutputSignature = signature;
      existing.lastOutputChangeAtMs = now;
    }

    return existing;
  }

  private resolveFallbackStatus(
    parsedStatus: Worker["status"],
    currentCommand: string,
    observation: PaneObservation,
    activity: ParsedActivity
  ): Worker["status"] {
    if (parsedStatus !== "working") {
      return parsedStatus;
    }

    const commandLower = currentCommand.toLowerCase();
    if (shellCommands.has(commandLower)) {
      return "idle";
    }

    const hasStrongActivitySignal =
      Boolean(activity.filePath) ||
      (Boolean(activity.tool) && activity.tool !== "terminal");

    if (!hasStrongActivitySignal && !commandLower.includes("claude")) {
      return "idle";
    }

    const now = Date.now();
    const quietForMs = now - Math.max(observation.lastCommandChangeAtMs, observation.lastOutputChangeAtMs);
    if (quietForMs >= nonShellIdleAfterMs) {
      return "idle";
    }

    return "working";
  }
}

function outputSignature(output: string): string {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-16)
    .join("\n");
}

function extractClaudeActiveTask(output: string): string | undefined {
  const linesNewestFirst = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-120)
    .reverse();

  for (const line of linesNewestFirst) {
    const match = line.match(/^(?:\*|•|·|✶)\s+(.+?)\s+\((?:[^)]*(?:thinking|thought\s+for)[^)]*)\)\s*$/i);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}
