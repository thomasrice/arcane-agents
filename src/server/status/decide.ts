import type { Worker } from "../../shared/types";
import type { PaneObservation } from "./paneObservation";
import type { ParsedActivity } from "./activityParser";
import type { ClaudeStatusSnapshot, TranscriptHealth } from "./claudeTranscriptTracker";
import type { AgentRuntimeProcess, KnownAgentRuntime } from "./runtimes/runtimeProcess";
import type { RuntimeAdapter, RuntimeAdapterId, RuntimeSignals } from "./runtimes/adapter";
import { preferOpenCodeSpecificActivityText } from "./runtimes/openCode";
import { buildWorkerSignals, type EvaluateWorkerStatusInput, type WorkerSignals } from "./collectSignals";

// ---------------------------------------------------------------------------
// Public decision types (the shape statusMonitor consumes)
// ---------------------------------------------------------------------------

export interface StatusReason {
  code: string;
  message: string;
  detail?: string;
}

export interface StatusDecisionFacts {
  command: string;
  commandQuietForMs: number;
  outputQuietForMs: number;
  workerAgeMs: number;
  runtime: RuntimeAdapterId;
  /** Claude transcript channel health ("absent" for non-Claude runtimes). */
  transcript: TranscriptHealth;
  runtimePromptSignal: boolean;
  runtimeActiveSignal: boolean;
  hasActiveClaudeTask: boolean;
  hasActiveRuntimeProcess: boolean;
  hasLiveGenericProcess: boolean;
  hasRuntimeActivityText: boolean;
  hasParsedStrongSignal: boolean;
  hasParsedNeedsInput: boolean;
  hasParsedError: boolean;
}

export interface WorkerStatusDecision {
  status: Worker["status"];
  activityText: Worker["activityText"];
  activityTool: Worker["activityTool"];
  activityPath: Worker["activityPath"];
  confidence: number;
  reasons: StatusReason[];
  facts: StatusDecisionFacts;
}

// ---------------------------------------------------------------------------
// Tuning constants (formerly engine/stateMachine/constants.ts)
// ---------------------------------------------------------------------------

const parsedStrongEvidenceWindowMs = 8_000;
const recentErrorSignalWindowMs = 15_000;
const commandWarmupWindowMs = 2_250;
const stickyWorkingWindowMs = 3_500;
const cachedActivityWindowMs = 12_000;

const fatalRuntimeErrorMatchers: RegExp[] = [
  /^traceback\b/i,
  /^unhandled(?:\s+\w+)?\s+exception\b/i,
  /^panic\b/i,
  /^fatal\b/i,
  /\b(out of memory|oom)\b/i,
  /\bsig(?:segv|kill|term)\b/i
];

const shellCommands = new Set(["bash", "zsh", "fish", "sh", "nu", "pwsh"]);

// ---------------------------------------------------------------------------
// Internal decision context
// ---------------------------------------------------------------------------

/**
 * The fully-derived view the decision logic works over: the collected
 * WorkerSignals plus the time-relative windows computed from `nowMs`. The
 * per-runtime convenience booleans are read directly off the single resolved
 * adapter + its detected signals.
 */
interface DecisionContext {
  worker: Worker;
  currentCommand: string;
  commandLower: string;
  output: string;
  observation: PaneObservation;
  transcriptSnapshot: ClaudeStatusSnapshot | undefined;
  transcriptHealth: TranscriptHealth;
  parsed: { activity: ParsedActivity };
  runtime: RuntimeAdapter;
  runtimeSignals: RuntimeSignals;
  runtimeActivityText: string | undefined;
  activeClaudeTask: string | undefined;
  activeRuntimeProcess: AgentRuntimeProcess | undefined;
  hasLiveGenericProcess: boolean;
  hasClaudePromptSignal: boolean;
  hasClaudeProgressSignal: boolean;
  hasClaudeInputPrompt: boolean;
  hasOpenCodePromptSignal: boolean;
  hasOpenCodeActiveSignal: boolean;
  hasCodexPromptSignal: boolean;
  hasCodexApprovalPrompt: boolean;
  hasCodexInputPrompt: boolean;
  hasCodexActiveSignal: boolean;
  hasOmpPromptSignal: boolean;
  hasOmpActiveSignal: boolean;
  isClaudeSession: boolean;
  isOpenCodeSession: boolean;
  isCodexSession: boolean;
  isOmpSession: boolean;
  outputQuietForMs: number;
  commandQuietForMs: number;
  workerAgeMs: number;
  interactiveCommands: ReadonlySet<string>;
  runtimeFreshnessWindowMs: number | undefined;
}

interface WorkingEvidence {
  strongReasons: StatusReason[];
  weakReasons: StatusReason[];
  activityTextCandidates: string[];
  activityToolCandidates: Array<Worker["activityTool"] | undefined>;
  activityPathCandidates: string[];
  parsedStrongSignal: boolean;
}

interface IdleBlocker {
  reason: StatusReason;
}

type ParserErrorClassification = "none" | "recoverable" | "fatal";

function toDecisionContext(worker: Worker, signals: WorkerSignals, nowMs: number): DecisionContext {
  const runtimeId = signals.runtime.id;
  const isClaudeSession = runtimeId === "claude";
  const isOpenCodeSession = runtimeId === "opencode";
  const isCodexSession = runtimeId === "codex";
  const isOmpSession = runtimeId === "omp";
  const rs = signals.runtimeSignals;
  const hasLiveGenericProcess =
    runtimeId === "generic" &&
    signals.commandLower.length > 0 &&
    !isShellCommand(signals.commandLower) &&
    !signals.interactiveCommands.has(signals.commandLower);

  const createdAtMs = Date.parse(worker.createdAt);
  const workerAgeMs = Number.isFinite(createdAtMs) ? Math.max(0, nowMs - createdAtMs) : Number.POSITIVE_INFINITY;

  return {
    worker,
    currentCommand: signals.currentCommand,
    commandLower: signals.commandLower,
    output: signals.output,
    observation: signals.observation,
    transcriptSnapshot: signals.transcriptSnapshot,
    transcriptHealth: signals.transcriptHealth,
    parsed: signals.parsed,
    runtime: signals.runtime,
    runtimeSignals: rs,
    runtimeActivityText: rs.activityText,
    activeClaudeTask: rs.activeTask,
    activeRuntimeProcess: signals.activeRuntimeProcess,
    hasLiveGenericProcess,
    hasClaudePromptSignal: isClaudeSession && rs.prompt,
    hasClaudeProgressSignal: isClaudeSession && rs.active,
    hasClaudeInputPrompt: isClaudeSession && Boolean(rs.awaitingInput),
    hasOpenCodePromptSignal: isOpenCodeSession && rs.prompt,
    hasOpenCodeActiveSignal: isOpenCodeSession && rs.active,
    hasCodexPromptSignal: isCodexSession && rs.prompt,
    hasCodexApprovalPrompt: isCodexSession && Boolean(rs.awaitingApproval),
    hasCodexInputPrompt: isCodexSession && Boolean(rs.awaitingInput),
    hasCodexActiveSignal: isCodexSession && rs.active,
    hasOmpPromptSignal: isOmpSession && rs.prompt,
    hasOmpActiveSignal: isOmpSession && rs.active,
    isClaudeSession,
    isOpenCodeSession,
    isCodexSession,
    isOmpSession,
    outputQuietForMs: Math.max(0, nowMs - signals.observation.lastOutputChangeAtMs),
    commandQuietForMs: Math.max(0, nowMs - signals.observation.lastCommandChangeAtMs),
    workerAgeMs,
    interactiveCommands: signals.interactiveCommands,
    runtimeFreshnessWindowMs: signals.runtimeFreshnessWindowMs
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function decide(worker: Worker, signals: WorkerSignals, nowMs: number): WorkerStatusDecision {
  return deriveWorkerStatusDecision(toDecisionContext(worker, signals, nowMs));
}

/**
 * Pure raw-inputs -> decision path. Builds the signals then decides against the
 * current clock. Used as the behavioural safety-net seam (integration test).
 */
export function evaluateWorkerStatus(input: EvaluateWorkerStatusInput): WorkerStatusDecision {
  const signals = buildWorkerSignals(input);
  return decide(input.worker, signals, Date.now());
}

// ---------------------------------------------------------------------------
// Decision state machine
// ---------------------------------------------------------------------------

function deriveWorkerStatusDecision(context: DecisionContext): WorkerStatusDecision {
  const reasons: StatusReason[] = [];

  const pushReason = (reason: StatusReason): void => {
    reasons.push(reason);
  };

  const transcriptStatus = context.transcriptSnapshot?.status;

  if (transcriptStatus === "attention") {
    pushReason({ code: "transcript-attention", message: "Transcript reports attention." });
    const activityText = context.transcriptSnapshot?.activityText ?? "Waiting for input";
    return finalizeDecision(context, {
      status: "attention",
      activityText,
      activityTool: context.transcriptSnapshot?.activityTool ?? "terminal",
      activityPath: context.transcriptSnapshot?.activityPath,
      confidence: 0.96,
      reasons,
      parsedStrongSignal: false
    });
  }

  if (context.hasClaudeInputPrompt && !context.hasClaudeProgressSignal && !isInteractiveCommand(context)) {
    pushReason({ code: "claude-input-prompt", message: "Claude is waiting for a question response." });
    return finalizeDecision(context, {
      status: "attention",
      activityText: context.runtimeActivityText ?? "Waiting for input",
      activityTool: "terminal",
      activityPath: undefined,
      confidence: 0.96,
      reasons,
      parsedStrongSignal: false
    });
  }

  if (context.hasCodexInputPrompt && !context.hasCodexActiveSignal && !isInteractiveCommand(context)) {
    pushReason({ code: "codex-input-prompt", message: "Codex is waiting for a question response." });
    return finalizeDecision(context, {
      status: "attention",
      activityText: context.runtimeActivityText ?? "Waiting for input",
      activityTool: "terminal",
      activityPath: undefined,
      confidence: 0.96,
      reasons,
      parsedStrongSignal: false
    });
  }

  if (context.hasCodexApprovalPrompt && !context.hasCodexActiveSignal && !isInteractiveCommand(context)) {
    // Only a genuine approval routes to attention. The codex `prompt` signal also
    // covers the ordinary at-rest input prompt (which merely classifies the pane
    // as codex); that bare input prompt is NOT an approval, so it falls through to
    // the idle path and a finished codex reads idle, not attention.
    pushReason({ code: "codex-approval-prompt", message: "Codex is waiting on an approval or question response." });
    return finalizeDecision(context, {
      status: "attention",
      activityText: context.runtimeActivityText ?? context.parsed.activity.text ?? "Waiting for approval",
      activityTool: "terminal",
      activityPath: undefined,
      confidence: 0.94,
      reasons,
      parsedStrongSignal: false
    });
  }

  if (context.parsed.activity.needsInput && !isInteractiveCommand(context)) {
    pushReason({ code: "parser-input-prompt", message: "Terminal output indicates input is required." });
    return finalizeDecision(context, {
      status: "attention",
      activityText: context.parsed.activity.text ?? "Waiting for input",
      activityTool: context.parsed.activity.tool ?? "terminal",
      activityPath: context.parsed.activity.filePath,
      confidence: 0.9,
      reasons,
      parsedStrongSignal: false
    });
  }

  if (transcriptStatus === "error") {
    pushReason({ code: "transcript-error", message: "Transcript reports error." });
    return finalizeDecision(context, {
      status: "error",
      activityText: context.transcriptSnapshot?.activityText ?? "Error",
      activityTool: context.transcriptSnapshot?.activityTool ?? "terminal",
      activityPath: context.transcriptSnapshot?.activityPath,
      confidence: 0.92,
      reasons,
      parsedStrongSignal: false
    });
  }

  if (isPromptDominantOpenCodeIdle(context)) {
    pushReason({
      code: "opencode-prompt-idle",
      message: "OpenCode prompt is visible without a fresh active execution signal."
    });
    return finalizeDecision(context, {
      status: "idle",
      activityText: undefined,
      activityTool: undefined,
      activityPath: undefined,
      confidence: 0.9,
      reasons,
      parsedStrongSignal: false
    });
  }

  const parserErrorClassification = isInteractiveCommand(context) ? "none" : classifyParserError(context);
  if (parserErrorClassification === "fatal" && transcriptStatus !== "working") {
    pushReason({
      code: "parser-error-signal",
      message: "Recent fatal error pattern detected in terminal output.",
      detail: `${Math.round(context.outputQuietForMs)}ms since output change`
    });
    return finalizeDecision(context, {
      status: "error",
      activityText: context.parsed.activity.text ?? "Error",
      activityTool: context.parsed.activity.tool ?? "terminal",
      activityPath: context.parsed.activity.filePath,
      confidence: 0.87,
      reasons,
      parsedStrongSignal: false
    });
  }

  if (parserErrorClassification === "recoverable") {
    pushReason({
      code: "parser-recoverable-error",
      message: "Tool-level error detected but considered recoverable.",
      detail: `${Math.round(context.outputQuietForMs)}ms since output change`
    });
  }

  const evidence = collectWorkingEvidence(context, parserErrorClassification === "recoverable");
  const idleBlocker = detectIdleBlocker(context, evidence);
  if (idleBlocker) {
    pushReason(idleBlocker.reason);
    return finalizeDecision(context, {
      status: "idle",
      activityText: undefined,
      activityTool: undefined,
      activityPath: undefined,
      confidence: 0.86,
      reasons,
      parsedStrongSignal: evidence.parsedStrongSignal
    });
  }

  if (evidence.strongReasons.length > 0) {
    for (const reason of evidence.strongReasons) {
      pushReason(reason);
    }

    const workingActivity = resolveWorkingActivity(context, evidence);
    return finalizeDecision(context, {
      status: "working",
      activityText: workingActivity.activityText,
      activityTool: workingActivity.activityTool,
      activityPath: workingActivity.activityPath,
      confidence: 0.88,
      reasons,
      parsedStrongSignal: evidence.parsedStrongSignal
    });
  }

  if (shouldKeepStickyWorking(context, evidence)) {
    pushReason({
      code: "sticky-working-window",
      message: "Keeps working status during a short stabilization window.",
      detail: `${Math.round(context.outputQuietForMs)}ms quiet`
    });

    const workingActivity = resolveWorkingActivity(context, evidence);
    return finalizeDecision(context, {
      status: "working",
      activityText: workingActivity.activityText,
      activityTool: workingActivity.activityTool,
      activityPath: workingActivity.activityPath,
      confidence: 0.66,
      reasons,
      parsedStrongSignal: evidence.parsedStrongSignal
    });
  }

  if (
    context.worker.status === "working" &&
    evidence.weakReasons.length > 0 &&
    context.outputQuietForMs <= statusFreshnessWindowMs(context.runtime, context.runtimeFreshnessWindowMs)
  ) {
    for (const reason of evidence.weakReasons) {
      pushReason(reason);
    }

    pushReason({
      code: "working-evidence-window",
      message: "Keeps working status while weak evidence remains within freshness window.",
      detail: `${Math.round(context.outputQuietForMs)}ms quiet`
    });

    const workingActivity = resolveWorkingActivity(context, evidence);
    return finalizeDecision(context, {
      status: "working",
      activityText: workingActivity.activityText,
      activityTool: workingActivity.activityTool,
      activityPath: workingActivity.activityPath,
      confidence: 0.62,
      reasons,
      parsedStrongSignal: evidence.parsedStrongSignal
    });
  }

  if (evidence.weakReasons.length > 0) {
    for (const reason of evidence.weakReasons) {
      pushReason(reason);
    }

    if (context.commandQuietForMs <= commandWarmupWindowMs) {
      const workingActivity = resolveWorkingActivity(context, evidence);
      return finalizeDecision(context, {
        status: "working",
        activityText: workingActivity.activityText,
        activityTool: workingActivity.activityTool,
        activityPath: workingActivity.activityPath,
        confidence: 0.56,
        reasons,
        parsedStrongSignal: evidence.parsedStrongSignal
      });
    }
  }

  pushReason({ code: "no-active-evidence", message: "No active work evidence remained within freshness windows." });
  return finalizeDecision(context, {
    status: "idle",
    activityText: undefined,
    activityTool: undefined,
    activityPath: undefined,
    confidence: 0.74,
    reasons,
    parsedStrongSignal: evidence.parsedStrongSignal
  });
}

function finalizeDecision(
  context: DecisionContext,
  partial: {
    status: Worker["status"];
    activityText: Worker["activityText"];
    activityTool: Worker["activityTool"];
    activityPath: Worker["activityPath"];
    confidence: number;
    reasons: StatusReason[];
    parsedStrongSignal: boolean;
  }
): WorkerStatusDecision {
  return {
    status: partial.status,
    activityText: partial.status === "idle" ? undefined : partial.activityText,
    activityTool: partial.status === "idle" ? undefined : partial.activityTool,
    activityPath: partial.status === "idle" ? undefined : partial.activityPath,
    confidence: partial.confidence,
    reasons: partial.reasons.length > 0 ? partial.reasons : [{ code: "no-reason", message: "No explicit reason captured." }],
    facts: {
      command: context.currentCommand,
      commandQuietForMs: context.commandQuietForMs,
      outputQuietForMs: context.outputQuietForMs,
      workerAgeMs: context.workerAgeMs,
      runtime: context.runtime.id,
      transcript: context.transcriptHealth,
      runtimePromptSignal: context.runtimeSignals.prompt,
      runtimeActiveSignal: context.runtimeSignals.active,
      hasActiveClaudeTask: Boolean(context.activeClaudeTask),
      hasActiveRuntimeProcess: Boolean(context.activeRuntimeProcess),
      hasLiveGenericProcess: context.hasLiveGenericProcess,
      hasRuntimeActivityText: Boolean(context.runtimeActivityText),
      hasParsedStrongSignal: partial.parsedStrongSignal,
      hasParsedNeedsInput: context.parsed.activity.needsInput,
      hasParsedError: context.parsed.activity.hasError
    }
  };
}

// ---------------------------------------------------------------------------
// Working evidence
// ---------------------------------------------------------------------------

function collectWorkingEvidence(context: DecisionContext, hasRecoverableParserError: boolean): WorkingEvidence {
  const strongReasons: StatusReason[] = [];
  const weakReasons: StatusReason[] = [];
  const activityTextCandidates: string[] = [];
  const activityToolCandidates: Array<Worker["activityTool"] | undefined> = [];
  const activityPathCandidates: string[] = [];

  const suppressShellHistorySignals = shouldSuppressShellHistorySignals(
    context.commandLower,
    context.runtime,
    context.interactiveCommands
  );

  // Fix (plan A6): the generic activity parser matches on any scrollback line
  // mentioning a tool/path word ("Read foo.ts", "git status"). For an AGENT
  // runtime that is a false-working source — the words linger in scrollback for
  // seconds after the agent has finished. An agent runtime therefore reads
  // working ONLY from its own native signals (adapter active, Claude
  // task/progress, transcript working, child process); parsed activity does not
  // count as working evidence at all. Generic/shell workers keep parsed activity
  // as strong evidence (a running build has no other signal to go on).
  // (The transcript-idle guard that used to gate this is now subsumed: transcript
  // snapshots only ever exist for the Claude adapter, which is an agent runtime.)
  const parsedStrongSignal =
    !isAgentRuntime(context.runtime) &&
    !suppressShellHistorySignals &&
    (Boolean(context.parsed.activity.filePath) ||
      (Boolean(context.parsed.activity.tool) && context.parsed.activity.tool !== "terminal"));

  if (context.transcriptSnapshot?.status === "working") {
    strongReasons.push({ code: "transcript-working", message: "Transcript reports active work." });
    pushMaybe(activityTextCandidates, context.transcriptSnapshot.activityText);
    activityToolCandidates.push(context.transcriptSnapshot.activityTool);
    pushMaybe(activityPathCandidates, context.transcriptSnapshot.activityPath);
  }

  if (context.activeClaudeTask) {
    strongReasons.push({ code: "claude-active-task", message: "Claude task summary indicates active work." });
    activityTextCandidates.push(context.activeClaudeTask);
    activityToolCandidates.push("terminal");
  }

  if (context.hasClaudeProgressSignal) {
    strongReasons.push({ code: "claude-progress-signal", message: "Claude live progress signal detected." });
    pushMaybe(activityTextCandidates, context.runtimeActivityText);
  }

  if (context.hasOpenCodeActiveSignal) {
    strongReasons.push({ code: "opencode-active-signal", message: "OpenCode active execution signal detected." });
    activityTextCandidates.push(context.runtimeActivityText ?? "Responding");
    activityToolCandidates.push("terminal");
  }

  if (context.hasCodexActiveSignal) {
    strongReasons.push({ code: "codex-active-signal", message: "Codex active execution signal detected." });
    activityTextCandidates.push(context.runtimeActivityText ?? "Responding");
    activityToolCandidates.push("terminal");
  }

  if (context.hasOmpActiveSignal) {
    strongReasons.push({ code: "omp-active-signal", message: "oh-my-pi active execution signal detected." });
    activityTextCandidates.push(context.runtimeActivityText ?? "Responding");
    activityToolCandidates.push("terminal");
  }

  if (context.activeRuntimeProcess && !isRuntimeProcessAtRest(context)) {
    strongReasons.push({
      code: "agent-runtime-child-process",
      message: `${labelRuntime(context.activeRuntimeProcess.runtime)} is still running under the pane shell.`
    });
    activityTextCandidates.push(context.runtimeActivityText ?? `${labelRuntime(context.activeRuntimeProcess.runtime)} running`);
    activityToolCandidates.push("terminal");
  }

  // Note: there is deliberately no "runtime activity text implies working" signal
  // here. The adapter's activityText is a scrollback-derived LABEL (what the agent
  // last did), not proof it is still running — it lingers after the turn ends and
  // was a second false-working source for agent runtimes. It is still used purely
  // for DISPLAY in resolveWorkingActivity once some native signal marks the worker
  // working. Working evidence comes only from the adapter's own active signal.

  if (parsedStrongSignal && context.outputQuietForMs <= parsedStrongEvidenceWindowMs) {
    strongReasons.push({
      code: "parsed-activity-signal",
      message: "Parsed tool/path signal indicates active work.",
      detail: `${Math.round(context.outputQuietForMs)}ms since output change`
    });
    pushMaybe(activityTextCandidates, context.parsed.activity.text);
    activityToolCandidates.push(context.parsed.activity.tool);
    pushMaybe(activityPathCandidates, context.parsed.activity.filePath);
  }

  if (context.hasLiveGenericProcess) {
    strongReasons.push({
      code: "generic-foreground-process",
      message: "A non-interactive foreground process is still running in the pane."
    });
    activityTextCandidates.push(`${context.currentCommand} running`);
    activityToolCandidates.push("terminal");
  }

  if (hasRecoverableParserError) {
    weakReasons.push({
      code: "recoverable-tool-error",
      message: "Recent tool error appears recoverable while the runtime remains active."
    });
    pushMaybe(activityTextCandidates, context.runtimeActivityText ?? context.parsed.activity.text ?? context.worker.activityText);
    activityToolCandidates.push(context.parsed.activity.tool ?? context.worker.activityTool ?? "terminal");
    pushMaybe(activityPathCandidates, context.parsed.activity.filePath ?? context.worker.activityPath);
  }

  if (hasActiveWorkActivityText(context.worker.activityText) && context.outputQuietForMs <= cachedActivityWindowMs) {
    weakReasons.push({ code: "cached-working-activity", message: "Recent activity text still suggests active work." });
    pushMaybe(activityTextCandidates, context.worker.activityText);
    activityToolCandidates.push(context.worker.activityTool);
    pushMaybe(activityPathCandidates, context.worker.activityPath);
  }

  if (
    context.commandQuietForMs <= commandWarmupWindowMs &&
    !isShellCommand(context.commandLower) &&
    !isInteractiveCommand(context) &&
    !context.parsed.activity.needsInput &&
    !context.parsed.activity.hasError
  ) {
    weakReasons.push({
      code: "recent-command-change",
      message: "Command changed recently; allowing short warmup period.",
      detail: `${Math.round(context.commandQuietForMs)}ms since command change`
    });
    pushMaybe(activityTextCandidates, context.runtimeActivityText ?? context.parsed.activity.text);
    activityToolCandidates.push(context.parsed.activity.tool);
    pushMaybe(activityPathCandidates, context.parsed.activity.filePath);
  }

  if (
    context.worker.status === "working" &&
    !isShellCommand(context.commandLower) &&
    !isInteractiveCommand(context) &&
    context.outputQuietForMs <= statusFreshnessWindowMs(context.runtime, context.runtimeFreshnessWindowMs) &&
    strongReasons.length === 0 &&
    weakReasons.length === 0
  ) {
    weakReasons.push({
      code: "output-still-fresh",
      message: "Output is still within the freshness window; maintaining working status.",
      detail: `${Math.round(context.outputQuietForMs)}ms quiet (window: ${statusFreshnessWindowMs(context.runtime, context.runtimeFreshnessWindowMs)}ms)`
    });
    pushMaybe(activityTextCandidates, context.runtimeActivityText ?? context.worker.activityText);
    activityToolCandidates.push(context.worker.activityTool ?? "terminal");
    pushMaybe(activityPathCandidates, context.worker.activityPath);
  }

  return {
    strongReasons,
    weakReasons,
    activityTextCandidates,
    activityToolCandidates,
    activityPathCandidates,
    parsedStrongSignal
  };
}

function shouldKeepStickyWorking(context: DecisionContext, evidence: WorkingEvidence): boolean {
  if (context.worker.status !== "working") {
    return false;
  }

  if (context.outputQuietForMs > stickyWorkingWindowMs) {
    return false;
  }

  return hasAnyWorkingEvidence(evidence);
}

/**
 * A live agent runtime process is working EVIDENCE only while the agent is
 * mid-turn. For an interpreter-hosted CLI the runtime process is the pane's own
 * long-lived process, so it stays alive while the agent sits idle at its prompt
 * — counting it there would pin the worker to a permanent false "working".
 * Suppress the child-process signal when the runtime is parked at its prompt
 * (Claude's ❯; Codex's input box) with no active-turn signal. Codex approvals
 * never reach here — they short-circuit to attention earlier.
 */
function isRuntimeProcessAtRest(context: DecisionContext): boolean {
  const runtime = context.activeRuntimeProcess?.runtime;

  if (runtime === "claude") {
    return context.hasClaudePromptSignal;
  }

  if (runtime === "codex") {
    return context.hasCodexPromptSignal && !context.hasCodexActiveSignal;
  }

  if (runtime === "omp") {
    return context.hasOmpPromptSignal && !context.hasOmpActiveSignal;
  }

  return false;
}

function labelRuntime(runtime: KnownAgentRuntime): string {
  switch (runtime) {
    case "claude":
      return "Claude";
    case "opencode":
      return "OpenCode";
    case "codex":
      return "Codex";
    case "omp":
      return "oh-my-pi";
  }
}

// ---------------------------------------------------------------------------
// Idle blockers
// ---------------------------------------------------------------------------

function isPromptDominantOpenCodeIdle(context: DecisionContext): boolean {
  return context.isOpenCodeSession && context.hasOpenCodePromptSignal && !context.hasOpenCodeActiveSignal;
}

function detectIdleBlocker(context: DecisionContext, evidence: WorkingEvidence): IdleBlocker | undefined {
  if (isShellCommand(context.commandLower) && context.transcriptSnapshot?.status !== "working") {
    if (hasAnyWorkingEvidence(evidence)) {
      return undefined;
    }

    return {
      reason: {
        code: "shell-command-idle",
        message: "Foreground command is shell; no explicit active-work transcript signal."
      }
    };
  }

  if (
    context.isClaudeSession &&
    context.runtime.spawnGraceMs !== undefined &&
    context.workerAgeMs <= context.runtime.spawnGraceMs &&
    context.transcriptSnapshot?.status !== "working" &&
    !context.activeClaudeTask &&
    !context.hasClaudeProgressSignal
  ) {
    return {
      reason: {
        code: "claude-spawn-grace-idle",
        message: "During early Claude spawn grace window without active signals.",
        detail: `${Math.round(context.workerAgeMs)}ms since worker creation`
      }
    };
  }

  if (
    context.isOpenCodeSession &&
    context.runtime.spawnGraceMs !== undefined &&
    context.workerAgeMs <= context.runtime.spawnGraceMs &&
    context.transcriptSnapshot?.status !== "working" &&
    !context.hasOpenCodeActiveSignal
  ) {
    return {
      reason: {
        code: "opencode-spawn-grace-idle",
        message: "During early OpenCode spawn grace window without active signals.",
        detail: `${Math.round(context.workerAgeMs)}ms since worker creation`
      }
    };
  }

  if (
    context.isCodexSession &&
    context.runtime.spawnGraceMs !== undefined &&
    context.workerAgeMs <= context.runtime.spawnGraceMs &&
    !context.hasCodexActiveSignal &&
    !context.activeRuntimeProcess
  ) {
    return {
      reason: {
        code: "codex-spawn-grace-idle",
        message: "During early Codex spawn grace window without active signals.",
        detail: `${Math.round(context.workerAgeMs)}ms since worker creation`
      }
    };
  }

  const activeWindowMs = statusFreshnessWindowMs(context.runtime, context.runtimeFreshnessWindowMs);
  if (
    context.outputQuietForMs > activeWindowMs &&
    context.transcriptSnapshot?.status !== "working" &&
    !context.hasLiveGenericProcess
  ) {
    return {
      reason: {
        code: "output-stale-idle",
        message: "Output has been quiet longer than active-work freshness window.",
        detail: `${Math.round(context.outputQuietForMs)}ms quiet (> ${activeWindowMs}ms)`
      }
    };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Parser error classification
// ---------------------------------------------------------------------------

function classifyParserError(context: DecisionContext): ParserErrorClassification {
  if (shouldSuppressShellHistorySignals(context.commandLower, context.runtime, context.interactiveCommands)) {
    return "none";
  }

  const hasRecentParserErrorSignal = context.parsed.activity.hasError && context.outputQuietForMs <= recentErrorSignalWindowMs;
  if (!hasRecentParserErrorSignal) {
    return "none";
  }

  if (!isAgentRuntime(context.runtime)) {
    return "fatal";
  }

  if (hasRecentFatalRuntimeError(context.output)) {
    return "fatal";
  }

  return "recoverable";
}

function hasRecentFatalRuntimeError(output: string): boolean {
  return recentNormalizedLines(output, 30).some((line) => fatalRuntimeErrorMatchers.some((matcher) => matcher.test(line)));
}

// ---------------------------------------------------------------------------
// Working activity resolution
// ---------------------------------------------------------------------------

function resolveWorkingActivity(
  context: DecisionContext,
  evidence: WorkingEvidence
): Pick<WorkerStatusDecision, "activityText" | "activityTool" | "activityPath"> {
  const fallbackText = firstDefined(
    ...evidence.activityTextCandidates,
    context.transcriptSnapshot?.activityText,
    context.runtimeActivityText,
    context.activeClaudeTask,
    context.parsed.activity.text,
    context.worker.activityText
  );

  const activityText = context.isOpenCodeSession
    ? preferOpenCodeSpecificActivityText(context.worker.activityText, fallbackText)
    : fallbackText;

  const activityTool = firstDefined<Worker["activityTool"]>(
    ...evidence.activityToolCandidates,
    context.transcriptSnapshot?.activityTool,
    context.parsed.activity.tool,
    context.worker.activityTool,
    "terminal"
  );

  const activityPath = firstDefined(
    ...evidence.activityPathCandidates,
    context.transcriptSnapshot?.activityPath,
    context.parsed.activity.filePath
  );

  return {
    activityText: activityText ?? "Working",
    activityTool,
    activityPath
  };
}

// ---------------------------------------------------------------------------
// Helpers (formerly engine/stateMachine/helpers.ts + runtime/textSignals.ts)
// ---------------------------------------------------------------------------

export function recentNormalizedLines(output: string, limit: number): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-limit)
    .map((line) => line.toLowerCase());
}

function isAgentRuntime(runtime: RuntimeAdapter): boolean {
  return runtime.id !== "generic";
}

export function shouldSuppressShellHistorySignals(
  commandLower: string,
  runtime: RuntimeAdapter,
  interactiveCommands: ReadonlySet<string>
): boolean {
  if (!isShellCommand(commandLower) && !interactiveCommands.has(commandLower)) {
    return false;
  }

  if (isAgentRuntime(runtime)) {
    return false;
  }

  return true;
}

function isInteractiveCommand(context: DecisionContext): boolean {
  return context.interactiveCommands.has(context.commandLower);
}

export function statusFreshnessWindowMs(runtime: RuntimeAdapter, runtimeFreshnessWindowMs: number | undefined): number {
  if (runtimeFreshnessWindowMs !== undefined) {
    return runtimeFreshnessWindowMs;
  }

  return runtime.freshnessWindowMs;
}

function isShellCommand(commandLower: string): boolean {
  return shellCommands.has(commandLower);
}

function pushMaybe(values: string[], value: string | undefined): void {
  if (!value) {
    return;
  }

  const normalized = value.trim();
  if (!normalized) {
    return;
  }

  values.push(normalized);
}

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function hasAnyWorkingEvidence(evidence: WorkingEvidence): boolean {
  return evidence.strongReasons.length > 0 || evidence.weakReasons.length > 0;
}

function hasActiveWorkActivityText(activityText: string | undefined): boolean {
  if (!activityText) {
    return false;
  }

  const normalized = activityText.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return /^(reading|editing|writing|running:?|searching|searched|subtask:|using|fetching|planning|responding|let me|fixing|working on)/.test(normalized);
}
