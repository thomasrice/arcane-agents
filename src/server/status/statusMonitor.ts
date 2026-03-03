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

type StatusTraceMode = "off" | "transitions" | "verbose";

export interface WorkerStatusDebugSnapshot {
  workerId: string;
  workerName: string;
  previousStatus: Worker["status"];
  evaluatedAt: string;
  decision: WorkerStatusEvaluation;
}

export interface WorkerStatusTransitionRecord {
  workerId: string;
  workerName: string;
  fromStatus: Worker["status"];
  toStatus: Worker["status"];
  at: string;
  confidence: number;
  reasons: WorkerStatusEvaluation["reasons"];
  facts: WorkerStatusEvaluation["facts"];
}

const defaultDecisionFacts = {
  command: "",
  commandQuietForMs: 0,
  outputQuietForMs: 0,
  workerAgeMs: 0,
  isClaudeSession: false,
  isOpenCodeSession: false,
  hasOpenCodePromptSignal: false,
  hasOpenCodeActiveSignal: false,
  hasClaudeProgressSignal: false,
  hasActiveClaudeTask: false,
  hasRuntimeActivityText: false,
  hasParsedStrongSignal: false,
  hasParsedNeedsInput: false,
  hasParsedError: false
};

const maxTransitionHistoryEntries = 40;

export class StatusMonitor {
  private intervalId: NodeJS.Timeout | undefined;
  private requestedPollTimer: NodeJS.Timeout | undefined;
  private pollInFlight = false;
  private pollRequestedWhileInFlight = false;
  private readonly claudeTranscript = new ClaudeTranscriptTracker();
  private readonly paneObservation = new Map<string, PaneObservation>();
  private readonly statusDebugByWorker = new Map<string, WorkerStatusDebugSnapshot>();
  private readonly statusTransitionHistoryByWorker = new Map<string, WorkerStatusTransitionRecord[]>();
  private readonly traceMode: StatusTraceMode = resolveStatusTraceMode();

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
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    if (this.requestedPollTimer) {
      clearTimeout(this.requestedPollTimer);
      this.requestedPollTimer = undefined;
    }
  }

  requestPollSoon(delayMs = 35): void {
    if (this.requestedPollTimer) {
      return;
    }

    this.requestedPollTimer = setTimeout(() => {
      this.requestedPollTimer = undefined;
      void this.pollOnce();
    }, Math.max(0, delayMs));
  }

  listWorkerStatusDebug(): WorkerStatusDebugSnapshot[] {
    return [...this.statusDebugByWorker.values()].sort((a, b) => a.workerName.localeCompare(b.workerName));
  }

  getWorkerStatusDebug(workerId: string): WorkerStatusDebugSnapshot | undefined {
    return this.statusDebugByWorker.get(workerId);
  }

  getWorkerStatusHistory(workerId: string): WorkerStatusTransitionRecord[] {
    return this.statusTransitionHistoryByWorker.get(workerId) ?? [];
  }

  async pollOnce(): Promise<void> {
    if (this.pollInFlight) {
      this.pollRequestedWhileInFlight = true;
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
      if (this.pollRequestedWhileInFlight) {
        this.pollRequestedWhileInFlight = false;
        this.requestPollSoon(0);
      }
    }
  }

  private async updateWorkerStatus(worker: Worker): Promise<void> {
    const live = await this.tmux.windowExists(worker.tmuxRef);
    if (!live) {
      const removed = this.workers.deleteWorker(worker.id);
      if (removed) {
        this.claudeTranscript.forget(worker.id);
        this.paneObservation.delete(worker.id);
        this.statusDebugByWorker.delete(worker.id);
        this.statusTransitionHistoryByWorker.delete(worker.id);
        this.onWorkerRemoved(worker.id);
      }
      return;
    }

    let evaluation: WorkerStatusEvaluation = {
      status: worker.status,
      activityText: worker.activityText,
      activityTool: worker.activityTool,
      activityPath: worker.activityPath,
      confidence: 0,
      reasons: [{ code: "not-evaluated", message: "Status evaluation did not run." }],
      facts: {
        ...defaultDecisionFacts
      }
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
          this.statusDebugByWorker.delete(worker.id);
          this.statusTransitionHistoryByWorker.delete(worker.id);
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
        activityPath: undefined,
        confidence: 0.25,
        reasons: [{ code: "status-check-failed", message: "Status monitoring raised an exception." }],
        facts: {
          ...defaultDecisionFacts
        }
      };
    }

    this.recordStatusDebug(worker, evaluation);
    this.traceStatusEvaluation(worker, evaluation);
    this.recordStatusTransition(worker, evaluation);

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
        this.statusDebugByWorker.delete(worker.id);
        this.statusTransitionHistoryByWorker.delete(worker.id);
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

  private recordStatusDebug(worker: Worker, evaluation: WorkerStatusEvaluation): void {
    this.statusDebugByWorker.set(worker.id, {
      workerId: worker.id,
      workerName: worker.displayName ?? worker.name,
      previousStatus: worker.status,
      evaluatedAt: new Date().toISOString(),
      decision: evaluation
    });
  }

  private traceStatusEvaluation(worker: Worker, evaluation: WorkerStatusEvaluation): void {
    if (this.traceMode === "off") {
      return;
    }

    const changed = evaluation.status !== worker.status;
    if (this.traceMode === "transitions" && !changed) {
      return;
    }

    const fromTo = changed ? `${worker.status} -> ${evaluation.status}` : `${evaluation.status}`;
    const reasonText = evaluation.reasons.map((reason) => formatReason(reason.code, reason.detail)).join(", ");
    const activityText = evaluation.activityText ? ` activity="${truncateForTrace(evaluation.activityText, 84)}"` : "";
    const commandText = truncateForTrace(evaluation.facts.command, 32);
    const traceFacts =
      `cmd=${JSON.stringify(commandText)} ` +
      `outQuiet=${Math.round(evaluation.facts.outputQuietForMs)}ms ` +
      `cmdQuiet=${Math.round(evaluation.facts.commandQuietForMs)}ms ` +
      `claude=${evaluation.facts.isClaudeSession ? 1 : 0} ` +
      `opencode=${evaluation.facts.isOpenCodeSession ? 1 : 0}`;

    // eslint-disable-next-line no-console
    console.log(
      `[overworld][status] ${worker.displayName ?? worker.name} ${fromTo} (${Math.round(evaluation.confidence * 100)}%)${activityText} reasons=[${reasonText}] ${traceFacts}`
    );
  }

  private recordStatusTransition(worker: Worker, evaluation: WorkerStatusEvaluation): void {
    if (evaluation.status === worker.status) {
      return;
    }

    const transition: WorkerStatusTransitionRecord = {
      workerId: worker.id,
      workerName: worker.displayName ?? worker.name,
      fromStatus: worker.status,
      toStatus: evaluation.status,
      at: new Date().toISOString(),
      confidence: evaluation.confidence,
      reasons: evaluation.reasons,
      facts: evaluation.facts
    };

    const history = this.statusTransitionHistoryByWorker.get(worker.id) ?? [];
    history.push(transition);
    if (history.length > maxTransitionHistoryEntries) {
      history.splice(0, history.length - maxTransitionHistoryEntries);
    }

    this.statusTransitionHistoryByWorker.set(worker.id, history);
  }
}

function resolveStatusTraceMode(): StatusTraceMode {
  const rawValue = (process.env.OVERWORLD_STATUS_TRACE ?? "").trim().toLowerCase();
  if (rawValue === "verbose" || rawValue === "2") {
    return "verbose";
  }

  if (
    rawValue === "transitions" ||
    rawValue === "1" ||
    rawValue === "true" ||
    rawValue === "on" ||
    rawValue === "yes"
  ) {
    return "transitions";
  }

  if (rawValue === "off" || rawValue === "0" || rawValue === "false" || rawValue === "no") {
    return "off";
  }

  return "off";
}

function formatReason(code: string, detail: string | undefined): string {
  if (!detail) {
    return code;
  }

  return `${code}:${truncateForTrace(detail, 48)}`;
}

function truncateForTrace(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 1) {
    return value.slice(0, Math.max(0, maxLength));
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}
