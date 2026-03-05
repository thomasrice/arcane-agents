import type { ResolvedConfig, Worker } from "../../shared/types";
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
type WorkerPollOutcome = "unchanged" | "updated" | "removed" | "failed";

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

export interface WorkerStatusTimingSnapshot {
  workerId: string;
  workerName: string;
  fromStatus: Worker["status"];
  toStatus: Worker["status"] | "stopped";
  outcome: WorkerPollOutcome;
  durationMs: number;
  evaluatedAt: string;
}

export interface StatusPollTimingSnapshot {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  workerCount: number;
  concurrency: number;
  averageWorkerDurationMs: number;
  maxWorkerDurationMs: number;
  outcomeCounts: {
    unchanged: number;
    updated: number;
    removed: number;
    failed: number;
  };
}

export interface StatusPerformanceDebugSnapshot {
  concurrency: number;
  latestPoll: StatusPollTimingSnapshot | undefined;
  recentPolls: StatusPollTimingSnapshot[];
  workers: WorkerStatusTimingSnapshot[];
}

interface WorkerStatusUpdateOutcome {
  outcome: WorkerPollOutcome;
  nextStatus: Worker["status"] | "stopped";
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
const maxPollTimingHistoryEntries = 40;
const defaultStatusPollConcurrency = 4;

export class StatusMonitor {
  private intervalId: NodeJS.Timeout | undefined;
  private requestedPollTimer: NodeJS.Timeout | undefined;
  private pollInFlight = false;
  private pollRequestedWhileInFlight = false;
  private readonly claudeTranscript = new ClaudeTranscriptTracker();
  private readonly paneObservation = new Map<string, PaneObservation>();
  private readonly statusDebugByWorker = new Map<string, WorkerStatusDebugSnapshot>();
  private readonly statusTransitionHistoryByWorker = new Map<string, WorkerStatusTransitionRecord[]>();
  private readonly workerTimingByWorker = new Map<string, WorkerStatusTimingSnapshot>();
  private readonly recentPollTiming: StatusPollTimingSnapshot[] = [];
  private readonly traceMode: StatusTraceMode = resolveStatusTraceMode();
  private readonly workerPollConcurrency = resolveStatusPollConcurrency();
  private readonly interactiveCommands: ReadonlySet<string>;

  constructor(
    private readonly workers: WorkerRepository,
    private readonly tmux: TmuxAdapter,
    private readonly pollIntervalMs: number,
    private readonly onWorkerUpdated: (worker: Worker) => void,
    private readonly onWorkerRemoved: (workerId: string) => void,
    config: ResolvedConfig
  ) {
    this.interactiveCommands = new Set(config.status.interactiveCommands.map((cmd) => cmd.toLowerCase()));
  }

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

  getStatusPerformanceDebug(): StatusPerformanceDebugSnapshot {
    return {
      concurrency: this.workerPollConcurrency,
      latestPoll: this.recentPollTiming[this.recentPollTiming.length - 1],
      recentPolls: [...this.recentPollTiming],
      workers: [...this.workerTimingByWorker.values()].sort((a, b) => a.workerName.localeCompare(b.workerName))
    };
  }

  async pollOnce(): Promise<void> {
    if (this.pollInFlight) {
      this.pollRequestedWhileInFlight = true;
      return;
    }

    this.pollInFlight = true;
    try {
      const pollStartedAtMs = Date.now();
      const currentWorkers = this.workers.listWorkers();
      const workerTimings = await mapWithConcurrency(currentWorkers, this.workerPollConcurrency, async (worker) =>
        this.evaluateWorkerWithTiming(worker)
      );

      this.recordPollTiming(pollStartedAtMs, currentWorkers.length, workerTimings);
    } finally {
      this.pollInFlight = false;
      if (this.pollRequestedWhileInFlight) {
        this.pollRequestedWhileInFlight = false;
        this.requestPollSoon(0);
      }
    }
  }

  private async evaluateWorkerWithTiming(worker: Worker): Promise<WorkerStatusTimingSnapshot> {
    const startedAtMs = Date.now();
    let outcome: WorkerPollOutcome = "failed";
    let toStatus: Worker["status"] | "stopped" = worker.status;

    try {
      const updateOutcome = await this.updateWorkerStatus(worker);
      outcome = updateOutcome.outcome;
      toStatus = updateOutcome.nextStatus;
    } catch {
      outcome = "failed";
      toStatus = "error";
    }

    const snapshot: WorkerStatusTimingSnapshot = {
      workerId: worker.id,
      workerName: worker.displayName ?? worker.name,
      fromStatus: worker.status,
      toStatus,
      outcome,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      evaluatedAt: new Date().toISOString()
    };

    if (outcome === "removed") {
      this.workerTimingByWorker.delete(worker.id);
    } else {
      this.workerTimingByWorker.set(worker.id, snapshot);
    }

    return snapshot;
  }

  private async updateWorkerStatus(worker: Worker): Promise<WorkerStatusUpdateOutcome> {
    const live = await this.tmux.windowExists(worker.tmuxRef);
    if (!live) {
      this.removeWorker(worker.id);
      return {
        outcome: "removed",
        nextStatus: "stopped"
      };
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
        claudeTranscript: this.claudeTranscript,
        interactiveCommands: this.interactiveCommands
      });

      if (!signals) {
        this.removeWorker(worker.id);
        return {
          outcome: "removed",
          nextStatus: "stopped"
        };
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
      return {
        outcome: "unchanged",
        nextStatus: worker.status
      };
    }

    if (evaluation.status === "stopped") {
      this.removeWorker(worker.id);
      return {
        outcome: "removed",
        nextStatus: "stopped"
      };
    }

    const updated = this.workers.updateStatus(worker.id, {
      status: evaluation.status,
      activityText: evaluation.activityText,
      activityTool: evaluation.activityTool,
      activityPath: evaluation.activityPath
    });
    if (updated) {
      this.onWorkerUpdated(updated);
      return {
        outcome: "updated",
        nextStatus: updated.status
      };
    }

    return {
      outcome: "failed",
      nextStatus: evaluation.status
    };
  }

  private removeWorker(workerId: string): void {
    const removed = this.workers.deleteWorker(workerId);
    if (removed) {
      this.claudeTranscript.forget(workerId);
      this.paneObservation.delete(workerId);
      this.statusDebugByWorker.delete(workerId);
      this.statusTransitionHistoryByWorker.delete(workerId);
      this.workerTimingByWorker.delete(workerId);
      this.onWorkerRemoved(workerId);
    }
  }

  private recordPollTiming(
    pollStartedAtMs: number,
    workerCount: number,
    workerTimings: WorkerStatusTimingSnapshot[]
  ): void {
    const pollFinishedAtMs = Date.now();
    const totalWorkerDurationMs = workerTimings.reduce((sum, timing) => sum + timing.durationMs, 0);
    const maxWorkerDurationMs = workerTimings.reduce((max, timing) => Math.max(max, timing.durationMs), 0);
    const averageWorkerDurationMs = workerTimings.length > 0 ? totalWorkerDurationMs / workerTimings.length : 0;
    const outcomeCounts: StatusPollTimingSnapshot["outcomeCounts"] = {
      unchanged: 0,
      updated: 0,
      removed: 0,
      failed: 0
    };

    for (const timing of workerTimings) {
      outcomeCounts[timing.outcome] += 1;
    }

    const pollTiming: StatusPollTimingSnapshot = {
      startedAt: new Date(pollStartedAtMs).toISOString(),
      finishedAt: new Date(pollFinishedAtMs).toISOString(),
      durationMs: Math.max(0, pollFinishedAtMs - pollStartedAtMs),
      workerCount,
      concurrency: this.workerPollConcurrency,
      averageWorkerDurationMs,
      maxWorkerDurationMs,
      outcomeCounts
    };

    this.recentPollTiming.push(pollTiming);
    if (this.recentPollTiming.length > maxPollTimingHistoryEntries) {
      this.recentPollTiming.splice(0, this.recentPollTiming.length - maxPollTimingHistoryEntries);
    }

    this.tracePollTiming(pollTiming);
  }

  private tracePollTiming(timing: StatusPollTimingSnapshot): void {
    if (this.traceMode !== "verbose") {
      return;
    }

    console.log(
      `[arcane-agents][status] poll workers=${timing.workerCount} duration=${Math.round(timing.durationMs)}ms ` +
        `avgWorker=${Math.round(timing.averageWorkerDurationMs)}ms maxWorker=${Math.round(timing.maxWorkerDurationMs)}ms ` +
        `outcomes={updated:${timing.outcomeCounts.updated},unchanged:${timing.outcomeCounts.unchanged},removed:${timing.outcomeCounts.removed},failed:${timing.outcomeCounts.failed}}`
    );
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

    console.log(
      `[arcane-agents][status] ${worker.displayName ?? worker.name} ${fromTo} (${Math.round(evaluation.confidence * 100)}%)${activityText} reasons=[${reasonText}] ${traceFacts}`
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

function resolveStatusPollConcurrency(): number {
  const rawValue = (process.env.ARCANE_AGENTS_STATUS_POLL_CONCURRENCY ?? "").trim();
  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isFinite(parsed) && parsed >= 1) {
    return Math.min(32, parsed);
  }

  return defaultStatusPollConcurrency;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const run = async (): Promise<void> => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex] as T, currentIndex);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => run()));
  return results;
}

function resolveStatusTraceMode(): StatusTraceMode {
  const rawValue = (process.env.ARCANE_AGENTS_STATUS_TRACE ?? "").trim().toLowerCase();
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
