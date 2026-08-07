import type { PromptSignature, ResolvedConfig, Worker } from "../../shared/types";
import { WorkerRepository } from "../persistence/workerRepository";
import { TmuxAdapter } from "../tmux/tmuxAdapter";
import type { PaneObservation } from "./paneObservation";
import { ClaudeTranscriptTracker, type ClaudeStatusSnapshot, type TranscriptHealth } from "./claudeTranscriptTracker";
import { truncateWithEllipsis } from "./runtimes/terminalText";
import { collectSignals, type WorkerSignals } from "./collectSignals";
import type { ClaudeTranscriptAttachment } from "./claudeTranscriptTracker";
import { decide, type StatusDecisionFacts, type StatusReason, type WorkerStatusDecision } from "./decide";
import type { RuntimeAdapterId, RuntimeSignals } from "./runtimes/adapter";
import type { AgentRuntimeProcess } from "./runtimes/runtimeProcess";
import { terminalUnavailableStatus } from "../orchestrator/reconcile/terminalAvailability";
import { compileStatusRules, type CompiledStatusRules } from "./customStatusRules";
import { compilePromptSignatures, type CompiledPromptSignatures } from "./promptSignatures";

type StatusTraceMode = "off" | "transitions" | "verbose";
type WorkerPollOutcome = "unchanged" | "updated" | "failed";

export interface WorkerStatusDebugSnapshot {
  workerId: string;
  workerName: string;
  previousStatus: Worker["status"];
  evaluatedAt: string;
  decision: WorkerStatusDecision;
  transcriptAttachment?: ClaudeTranscriptAttachment;
}

export interface WorkerStatusTransitionRecord {
  workerId: string;
  workerName: string;
  fromStatus: Worker["status"];
  toStatus: Worker["status"];
  at: string;
  confidence: number;
  reasons: WorkerStatusDecision["reasons"];
  facts: WorkerStatusDecision["facts"];
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

/**
 * Compact per-poll evaluation record (feature 3). Deliberately carries NO pane
 * text so a full ring of these stays cheap; the raw inputs needed to reproduce a
 * decision live in the transition capture ring / latest-inputs slot instead.
 */
export interface WorkerStatusEvaluationSample {
  at: string;
  status: Worker["status"];
  adapterId: RuntimeAdapterId;
  runtimeSignals: { prompt: boolean; active: boolean };
  promptSignatureId: string | undefined;
  transcriptHealth: TranscriptHealth;
  outputQuietForMs: number;
  reasonCodes: string[];
}

/**
 * The full decision inputs retained at a status transition (feature 1) and in the
 * one-slot latest-evaluation cache that powers `?current=1` (feature 3). Shaped so
 * the fixture endpoint can project it straight onto the integration suite's
 * EvaluateOptions. Mutable poll-owned objects (observation, runtimeSignals,
 * transcript snapshot, runtime process) are snapshot-copied when captured so a
 * later poll's in-place mutation cannot rewrite retained history.
 */
export interface CapturedDecisionInputs {
  capturedAt: string;
  fromStatus: Worker["status"];
  toStatus: Worker["status"];
  adapterId: RuntimeAdapterId;
  output: string;
  visibleOutput: string | undefined;
  currentCommand: string;
  outputQuietForMs: number;
  commandQuietForMs: number;
  workerAgeMs: number;
  runtimeSignals: RuntimeSignals;
  transcriptSnapshot: ClaudeStatusSnapshot | undefined;
  transcriptHealth: TranscriptHealth;
  observation: PaneObservation;
  runtimeProcess: AgentRuntimeProcess | undefined;
  interactiveCommands: readonly string[];
  promptSignatures: readonly PromptSignature[];
  runtimeFreshnessWindowMs: number | undefined;
  decision: { status: Worker["status"]; reasons: StatusReason[]; confidence: number };
}

/** A `WorkerStatusDebugSnapshot` plus the read-time flap count (feature 4). */
export interface WorkerStatusDebugListEntry extends WorkerStatusDebugSnapshot {
  transitionsLastHour: number;
}

/** The EvaluateOptions-shaped body of a fixture document (feature 2). */
export interface StatusFixturePayload {
  runtime: RuntimeAdapterId;
  output: string;
  outputQuietForMs: number;
  visibleOutput?: string;
  commandQuietForMs: number;
  workerAgeMs: number;
  priorStatus: Worker["status"];
  currentCommand: string;
  interactiveCommands: readonly string[];
  transcriptSnapshot: ClaudeStatusSnapshot | null;
  promptSignatures: readonly PromptSignature[];
  runtimeFreshnessWindowMs: number | null;
}

export interface StatusFixtureDocument {
  capturedAt: string;
  worker: { id: string; name: string; runtimeId: string };
  fixture: StatusFixturePayload | null;
  decision: { status: Worker["status"]; reasons: StatusReason[]; confidence: number } | null;
  transitions: number;
}

export type StatusFixtureResult = { found: false } | { found: true; document: StatusFixtureDocument };

export interface StatusFixtureQuery {
  useCurrent: boolean;
  transitionIndex: number | undefined;
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

export interface StatusMonitorOptions {
  workers: WorkerRepository;
  tmux: TmuxAdapter;
  pollIntervalMs: number;
  onWorkerUpdated: (worker: Worker) => void;
  config: ResolvedConfig;
}

const defaultDecisionFacts: StatusDecisionFacts = {
  command: "",
  commandQuietForMs: 0,
  outputQuietForMs: 0,
  workerAgeMs: 0,
  runtime: "generic",
  transcript: "absent",
  runtimePromptSignal: false,
  promptSignatureId: undefined,
  runtimeActiveSignal: false,
  hasActiveClaudeTask: false,
  hasActiveRuntimeProcess: false,
  hasLiveGenericProcess: false,
  hasRuntimeActivityText: false,
  hasParsedStrongSignal: false,
  hasParsedNeedsInput: false,
  hasParsedError: false
};

const maxTransitionHistoryEntries = 40;
const maxPollTimingHistoryEntries = 40;
const defaultStatusPollConcurrency = 4;
// Ring-buffer bounds for the status-debugging telemetry.
const maxTransitionCaptureEntries = 5;
const maxEvaluationSampleEntries = 10;
// Window the /api/status-debug flap summary counts recent transitions over.
// NOTE: recent transitions are counted from `statusTransitionHistoryByWorker`,
// which is bounded at `maxTransitionHistoryEntries` (40). A worker flapping more
// than 40 times inside the window will under-report `transitionsLastHour` — the
// count is deliberately taken from the already-bounded history rather than
// growing an unbounded per-worker timestamp list just for this summary.
const flapWindowMs = 60 * 60 * 1_000;

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
  // Status-debugging telemetry (bounded, in-memory, no persistence):
  //   transitionCaptureByWorker — last 5 full decision inputs at each transition
  //   evaluationSampleByWorker   — last 10 compact per-poll samples (no pane text)
  //   latestInputsByWorker       — one slot of full inputs from the latest poll
  private readonly transitionCaptureByWorker = new Map<string, CapturedDecisionInputs[]>();
  private readonly evaluationSampleByWorker = new Map<string, WorkerStatusEvaluationSample[]>();
  private readonly latestInputsByWorker = new Map<string, CapturedDecisionInputs>();
  private readonly recentPollTiming: StatusPollTimingSnapshot[] = [];
  private readonly traceMode: StatusTraceMode = resolveStatusTraceMode();
  private readonly workerPollConcurrency = resolveStatusPollConcurrency();
  private readonly interactiveCommands: ReadonlySet<string>;
  // Stable array copy of interactiveCommands so each capture shares one reference
  // (the set is config-level and never changes) rather than re-spreading per poll.
  private readonly interactiveCommandsSnapshot: readonly string[];
  private readonly runtimeFreshnessOverrides: ReadonlyMap<string, number>;
  private readonly customStatusRules: CompiledStatusRules;
  private readonly promptSignatures: CompiledPromptSignatures;
  private readonly promptSignaturesSnapshot: readonly PromptSignature[];
  private readonly workers: WorkerRepository;
  private readonly tmux: TmuxAdapter;
  private readonly pollIntervalMs: number;
  private readonly onWorkerUpdated: (worker: Worker) => void;

  constructor(options: StatusMonitorOptions) {
    this.workers = options.workers;
    this.tmux = options.tmux;
    this.pollIntervalMs = options.pollIntervalMs;
    this.onWorkerUpdated = options.onWorkerUpdated;

    const config = options.config;
    this.interactiveCommands = new Set(config.status.interactiveCommands.map((cmd) => cmd.toLowerCase()));
    this.interactiveCommandsSnapshot = [...this.interactiveCommands];
    this.customStatusRules = compileStatusRules(config.status.rules);
    this.promptSignaturesSnapshot = config.status.promptSignatures.map((signature) => ({
      ...signature,
      all: [...signature.all]
    }));
    this.promptSignatures = compilePromptSignatures(this.promptSignaturesSnapshot);

    const freshnessOverrides = new Map<string, number>();
    for (const [id, runtime] of Object.entries(config.runtimes)) {
      if (runtime.freshnessWindowMs !== undefined) {
        freshnessOverrides.set(id, runtime.freshnessWindowMs);
      }
    }
    this.runtimeFreshnessOverrides = freshnessOverrides;
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

  listWorkerStatusDebug(): WorkerStatusDebugListEntry[] {
    const nowMs = Date.now();
    // Flap summary (feature 4): decorate each snapshot with its recent-transition
    // count and surface the noisiest workers first so a misbehaving worker is
    // findable in this one request; ties fall back to alphabetical name order.
    return [...this.statusDebugByWorker.values()]
      .map((snapshot) => ({
        ...snapshot,
        transitionsLastHour: this.countRecentTransitions(snapshot.workerId, nowMs)
      }))
      .sort(
        (a, b) => b.transitionsLastHour - a.transitionsLastHour || a.workerName.localeCompare(b.workerName)
      );
  }

  getWorkerStatusDebug(workerId: string): WorkerStatusDebugSnapshot | undefined {
    return this.statusDebugByWorker.get(workerId);
  }

  getWorkerStatusHistory(workerId: string): WorkerStatusTransitionRecord[] {
    return this.statusTransitionHistoryByWorker.get(workerId) ?? [];
  }

  getWorkerStatusEvaluations(workerId: string): WorkerStatusEvaluationSample[] {
    return this.evaluationSampleByWorker.get(workerId) ?? [];
  }

  /**
   * Build the EvaluateOptions-shaped fixture document for a worker (feature 2).
   * Returns `{ found: false }` for an unknown worker (route maps to 404); a known
   * worker with no captured source yet yields a 200 empty-state document
   * (`fixture: null`, `transitions: 0`). `useCurrent` builds from the latest full
   * evaluation instead of a transition; `transitionIndex` selects the n-th most
   * recent transition (0 = latest, the default).
   */
  buildStatusFixture(workerId: string, query: StatusFixtureQuery): StatusFixtureResult {
    const worker = this.workers.getWorker(workerId);
    if (!worker) {
      return { found: false };
    }

    const captures = this.transitionCaptureByWorker.get(workerId) ?? [];
    const captured = query.useCurrent
      ? this.latestInputsByWorker.get(workerId)
      : resolveTransitionCapture(captures, query.transitionIndex);

    return {
      found: true,
      document: toStatusFixtureDocument(worker, captured, captures.length)
    };
  }

  private countRecentTransitions(workerId: string, nowMs: number): number {
    const history = this.statusTransitionHistoryByWorker.get(workerId);
    if (!history) {
      return 0;
    }

    const cutoffMs = nowMs - flapWindowMs;
    let count = 0;
    for (const record of history) {
      if (Date.parse(record.at) >= cutoffMs) {
        count += 1;
      }
    }

    return count;
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
      if (currentWorkers.length > 0 && !(await this.tmux.hasManagedSession())) {
        const workerTimings = await mapWithConcurrency(currentWorkers, this.workerPollConcurrency, async (worker) =>
          this.markTerminalUnavailableWithTiming(worker)
        );
        this.recordPollTiming(pollStartedAtMs, currentWorkers.length, workerTimings);
        return;
      }

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

    this.workerTimingByWorker.set(worker.id, snapshot);

    return snapshot;
  }

  private async updateWorkerStatus(worker: Worker): Promise<WorkerStatusUpdateOutcome> {
    const live = await this.tmux.windowExists(worker.tmuxRef);
    if (!live) {
      return this.markTerminalUnavailable(worker);
    }

    let evaluation: WorkerStatusDecision = {
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
    // The raw inputs and the exact clock the decision ran against, retained so the
    // status-debugging telemetry can reproduce the decision as a fixture. Left
    // undefined on the failure path (no real inputs to capture).
    let signals: WorkerSignals | undefined;
    let decisionAtMs = Date.now();

    try {
      const collected = await collectSignals({
        worker,
        tmux: this.tmux,
        paneObservation: this.paneObservation,
        claudeTranscript: this.claudeTranscript,
        interactiveCommands: this.interactiveCommands,
        runtimeFreshnessWindowMs: this.runtimeFreshnessOverrides.get(worker.runtimeId),
        customStatusRules: this.customStatusRules,
        promptSignatures: this.promptSignatures
      });

      if (!collected) {
        return this.markTerminalUnavailable(worker);
      }

      signals = collected;
      decisionAtMs = Date.now();
      evaluation = decide(worker, signals, decisionAtMs);
    } catch {
      signals = undefined;
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

    this.recordStatusDebug(worker, evaluation, signals);
    this.traceStatusEvaluation(worker, evaluation);
    this.recordStatusEvaluationSample(worker, evaluation, decisionAtMs);
    if (signals) {
      this.latestInputsByWorker.set(worker.id, this.buildCapturedInputs(worker, evaluation, signals, decisionAtMs));
    }
    this.recordStatusTransition(worker, evaluation, signals, decisionAtMs);

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

  private markTerminalUnavailable(worker: Worker): WorkerStatusUpdateOutcome {
    this.claudeTranscript.forget(worker.id);
    this.paneObservation.delete(worker.id);
    this.latestInputsByWorker.delete(worker.id);

    if (
      worker.status === terminalUnavailableStatus.status &&
      worker.activityText === terminalUnavailableStatus.activityText &&
      worker.activityTool === terminalUnavailableStatus.activityTool &&
      worker.activityPath === terminalUnavailableStatus.activityPath
    ) {
      return { outcome: "unchanged", nextStatus: worker.status };
    }

    const updated = this.workers.updateStatus(worker.id, terminalUnavailableStatus);
    if (!updated) {
      return { outcome: "failed", nextStatus: terminalUnavailableStatus.status };
    }

    this.onWorkerUpdated(updated);
    return { outcome: "updated", nextStatus: updated.status };
  }

  private async markTerminalUnavailableWithTiming(worker: Worker): Promise<WorkerStatusTimingSnapshot> {
    const startedAtMs = Date.now();
    const result = this.markTerminalUnavailable(worker);
    return {
      workerId: worker.id,
      workerName: worker.displayName ?? worker.name,
      fromStatus: worker.status,
      toStatus: result.nextStatus,
      outcome: result.outcome,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      evaluatedAt: new Date().toISOString()
    };
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

    const timestamp = new Date().toLocaleTimeString("en-AU", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    console.log(
      `[arcane-agents][status] ${timestamp} poll workers=${timing.workerCount} duration=${Math.round(timing.durationMs)}ms ` +
        `avgWorker=${Math.round(timing.averageWorkerDurationMs)}ms maxWorker=${Math.round(timing.maxWorkerDurationMs)}ms ` +
        `outcomes={updated:${timing.outcomeCounts.updated},unchanged:${timing.outcomeCounts.unchanged},failed:${timing.outcomeCounts.failed}}`
    );
  }

  private recordStatusDebug(
    worker: Worker,
    evaluation: WorkerStatusDecision,
    signals: WorkerSignals | undefined
  ): void {
    this.statusDebugByWorker.set(worker.id, {
      workerId: worker.id,
      workerName: worker.displayName ?? worker.name,
      previousStatus: worker.status,
      evaluatedAt: new Date().toISOString(),
      decision: evaluation,
      transcriptAttachment: signals?.transcriptAttachment
    });
  }

  private traceStatusEvaluation(worker: Worker, evaluation: WorkerStatusDecision): void {
    if (this.traceMode === "off") {
      return;
    }

    const changed = evaluation.status !== worker.status;
    if (this.traceMode === "transitions" && !changed) {
      return;
    }

    const fromTo = changed ? `${worker.status} -> ${evaluation.status}` : `${evaluation.status}`;
    const reasonText = evaluation.reasons.map((reason) => formatReason(reason.code, reason.detail)).join(", ");
    const activityText = evaluation.activityText ? ` activity="${truncateWithEllipsis(evaluation.activityText, 84)}"` : "";
    const commandText = truncateWithEllipsis(evaluation.facts.command, 32);
    const traceFacts =
      `cmd=${JSON.stringify(commandText)} ` +
      `outQuiet=${Math.round(evaluation.facts.outputQuietForMs)}ms ` +
      `cmdQuiet=${Math.round(evaluation.facts.commandQuietForMs)}ms ` +
      `runtime=${evaluation.facts.runtime} ` +
      `transcript=${evaluation.facts.transcript} ` +
      `prompt=${evaluation.facts.runtimePromptSignal ? 1 : 0} ` +
      `signature=${JSON.stringify(evaluation.facts.promptSignatureId ?? "")} ` +
      `active=${evaluation.facts.runtimeActiveSignal ? 1 : 0} ` +
      `runtimeProc=${evaluation.facts.hasActiveRuntimeProcess ? 1 : 0} ` +
      `genericProc=${evaluation.facts.hasLiveGenericProcess ? 1 : 0}`;

    const timestamp = new Date().toLocaleTimeString("en-AU", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    console.log(
      `[arcane-agents][status] ${timestamp} ${worker.displayName ?? worker.name} ${fromTo} (${Math.round(evaluation.confidence * 100)}%)${activityText} reasons=[${reasonText}] ${traceFacts}`
    );
  }

  private recordStatusTransition(
    worker: Worker,
    evaluation: WorkerStatusDecision,
    signals: WorkerSignals | undefined,
    decisionAtMs: number
  ): void {
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

    // Feature 1: retain the full decision inputs behind this transition so it can
    // be reproduced as a fixture. Only possible when the poll actually collected
    // signals (the failure path has no real inputs).
    if (signals) {
      this.recordTransitionCapture(worker, evaluation, signals, decisionAtMs);
    }
  }

  private recordStatusEvaluationSample(worker: Worker, evaluation: WorkerStatusDecision, decisionAtMs: number): void {
    // Compact, pane-text-free (feature 3): everything here is read off the decision
    // facts/reasons, so it records on every poll including the failure path.
    const sample: WorkerStatusEvaluationSample = {
      at: new Date(decisionAtMs).toISOString(),
      status: evaluation.status,
      adapterId: evaluation.facts.runtime,
      runtimeSignals: {
        prompt: evaluation.facts.runtimePromptSignal,
        active: evaluation.facts.runtimeActiveSignal
      },
      promptSignatureId: evaluation.facts.promptSignatureId,
      transcriptHealth: evaluation.facts.transcript,
      outputQuietForMs: evaluation.facts.outputQuietForMs,
      reasonCodes: evaluation.reasons.map((reason) => reason.code)
    };

    const samples = this.evaluationSampleByWorker.get(worker.id) ?? [];
    samples.push(sample);
    if (samples.length > maxEvaluationSampleEntries) {
      samples.splice(0, samples.length - maxEvaluationSampleEntries);
    }

    this.evaluationSampleByWorker.set(worker.id, samples);
  }

  private recordTransitionCapture(
    worker: Worker,
    evaluation: WorkerStatusDecision,
    signals: WorkerSignals,
    decisionAtMs: number
  ): void {
    const capture = this.buildCapturedInputs(worker, evaluation, signals, decisionAtMs);
    const captures = this.transitionCaptureByWorker.get(worker.id) ?? [];
    captures.push(capture);
    if (captures.length > maxTransitionCaptureEntries) {
      captures.splice(0, captures.length - maxTransitionCaptureEntries);
    }

    this.transitionCaptureByWorker.set(worker.id, captures);
  }

  private buildCapturedInputs(
    worker: Worker,
    evaluation: WorkerStatusDecision,
    signals: WorkerSignals,
    decisionAtMs: number
  ): CapturedDecisionInputs {
    // Snapshot-copy every poll-owned mutable object; observePane in particular
    // returns and mutates ONE PaneObservation instance across polls, so retaining
    // the live reference would let a later poll rewrite this captured history.
    return {
      capturedAt: new Date(decisionAtMs).toISOString(),
      fromStatus: worker.status,
      toStatus: evaluation.status,
      adapterId: signals.runtime.id,
      output: signals.output,
      currentCommand: signals.currentCommand,
      visibleOutput: signals.visibleOutput,
      outputQuietForMs: evaluation.facts.outputQuietForMs,
      commandQuietForMs: evaluation.facts.commandQuietForMs,
      workerAgeMs: evaluation.facts.workerAgeMs,
      runtimeSignals: {
        prompt: signals.runtimeSignals.prompt,
        active: signals.runtimeSignals.active,
        activityText: signals.runtimeSignals.activityText,
        activeTask: signals.runtimeSignals.activeTask
      },
      transcriptSnapshot: signals.transcriptSnapshot ? { ...signals.transcriptSnapshot } : undefined,
      transcriptHealth: signals.transcriptHealth,
      observation: { ...signals.observation },
      runtimeProcess: signals.activeRuntimeProcess ? { ...signals.activeRuntimeProcess } : undefined,
      interactiveCommands: this.interactiveCommandsSnapshot,
      promptSignatures: this.promptSignaturesSnapshot,
      runtimeFreshnessWindowMs: signals.runtimeFreshnessWindowMs,
      decision: {
        status: evaluation.status,
        reasons: evaluation.reasons,
        confidence: evaluation.confidence
      }
    };
  }
}

function resolveTransitionCapture(
  captures: readonly CapturedDecisionInputs[],
  index: number | undefined
): CapturedDecisionInputs | undefined {
  if (captures.length === 0) {
    return undefined;
  }

  // Index counts newest-first (0 = latest transition), matching the "default
  // latest" contract; the ring itself is stored oldest -> newest.
  const newestFirstIndex = index ?? 0;
  const arrayIndex = captures.length - 1 - newestFirstIndex;
  if (arrayIndex < 0 || arrayIndex >= captures.length) {
    return undefined;
  }

  return captures[arrayIndex];
}

function toStatusFixtureDocument(
  worker: Worker,
  captured: CapturedDecisionInputs | undefined,
  transitionsCount: number
): StatusFixtureDocument {
  const workerSummary = {
    id: worker.id,
    name: worker.displayName ?? worker.name,
    runtimeId: worker.runtimeId
  };

  if (!captured) {
    return {
      capturedAt: new Date().toISOString(),
      worker: workerSummary,
      fixture: null,
      decision: null,
      transitions: transitionsCount
    };
  }

  return {
    capturedAt: captured.capturedAt,
    worker: workerSummary,
    fixture: {
      runtime: captured.adapterId,
      output: captured.output,
      visibleOutput: captured.visibleOutput,
      outputQuietForMs: captured.outputQuietForMs,
      commandQuietForMs: captured.commandQuietForMs,
      workerAgeMs: captured.workerAgeMs,
      priorStatus: captured.fromStatus,
      currentCommand: captured.currentCommand,
      interactiveCommands: captured.interactiveCommands,
      promptSignatures: captured.promptSignatures,
      transcriptSnapshot: captured.transcriptSnapshot ?? null,
      runtimeFreshnessWindowMs: captured.runtimeFreshnessWindowMs ?? null
    },
    decision: {
      status: captured.decision.status,
      reasons: captured.decision.reasons,
      confidence: captured.decision.confidence
    },
    transitions: transitionsCount
  };
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

  return `${code}:${truncateWithEllipsis(detail, 48)}`;
}
