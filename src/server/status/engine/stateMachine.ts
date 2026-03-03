import type { Worker } from "../../../shared/types";
import { hasActiveWorkActivityText, hasWaitingActivityText, preferOpenCodeSpecificActivityText } from "../runtimeSignals";
import type { StatusReason, WorkerStatusDecision, WorkerStatusSignalContext } from "./types";

const shellCommands = new Set(["bash", "zsh", "fish", "sh", "nu", "pwsh"]);

const parsedStrongEvidenceWindowMs = 8_000;
const recentErrorSignalWindowMs = 15_000;
const commandWarmupWindowMs = 2_250;
const stickyWorkingWindowMs = 3_500;
const cachedActivityWindowMs = 12_000;
const claudeSpawnGraceMs = 5_000;
const genericWorkingFreshWindowMs = 12_000;
const claudeWorkingFreshWindowMs = 10_000;
const openCodeWorkingFreshWindowMs = 12_000;

const fatalRuntimeErrorMatchers: RegExp[] = [
  /^traceback\b/i,
  /^unhandled(?:\s+\w+)?\s+exception\b/i,
  /^panic\b/i,
  /^fatal\b/i,
  /\b(out of memory|oom)\b/i,
  /\bsig(?:segv|kill|term)\b/i
];

const recoverableToolErrorMatchers: RegExp[] = [
  /request failed with status code\s*:?\s*\d{3}/i,
  /\b(?:unauthorized|forbidden|rate limit|too many requests)\b/i,
  /\b(?:timed?\s*out|timeout)\b/i,
  /\b(?:network error|connection reset|connection refused|econnreset|econnrefused|enotfound)\b/i,
  /\bhttp(?:\s+status)?\s*(?:code)?\s*:?\s*(?:401|403|404|408|409|410|422|429|500|502|503|504)\b/i
];

type ParserErrorClassification = "none" | "recoverable" | "fatal";

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

export function deriveWorkerStatusDecision(context: WorkerStatusSignalContext): WorkerStatusDecision {
  const reasons: StatusReason[] = [];

  const pushReason = (reason: StatusReason): void => {
    reasons.push(reason);
  };

  const transcriptStatus = context.transcriptSnapshot?.status;

  if (transcriptStatus === "attention") {
    pushReason({ code: "transcript-attention", message: "Transcript reports attention." });
    const activityText = context.transcriptSnapshot?.activityText ?? "Waiting for input";
    return finalizeDecision(
      context,
      {
        status: "attention",
        activityText,
        activityTool: context.transcriptSnapshot?.activityTool ?? "terminal",
        activityPath: context.transcriptSnapshot?.activityPath,
        confidence: 0.96,
        reasons,
        parsedStrongSignal: false
      }
    );
  }

  if (context.parsed.activity.needsInput) {
    pushReason({ code: "parser-input-prompt", message: "Terminal output indicates input is required." });
    return finalizeDecision(
      context,
      {
        status: "attention",
        activityText: context.parsed.activity.text ?? "Waiting for input",
        activityTool: context.parsed.activity.tool ?? "terminal",
        activityPath: context.parsed.activity.filePath,
        confidence: 0.9,
        reasons,
        parsedStrongSignal: false
      }
    );
  }

  if (transcriptStatus === "error") {
    pushReason({ code: "transcript-error", message: "Transcript reports error." });
    return finalizeDecision(
      context,
      {
        status: "error",
        activityText: context.transcriptSnapshot?.activityText ?? "Error",
        activityTool: context.transcriptSnapshot?.activityTool ?? "terminal",
        activityPath: context.transcriptSnapshot?.activityPath,
        confidence: 0.92,
        reasons,
        parsedStrongSignal: false
      }
    );
  }

  const parserErrorClassification = classifyParserError(context);
  if (parserErrorClassification === "fatal" && transcriptStatus !== "working") {
    pushReason({
      code: "parser-error-signal",
      message: "Recent fatal error pattern detected in terminal output.",
      detail: `${Math.round(context.outputQuietForMs)}ms since output change`
    });
    return finalizeDecision(
      context,
      {
        status: "error",
        activityText: context.parsed.activity.text ?? "Error",
        activityTool: context.parsed.activity.tool ?? "terminal",
        activityPath: context.parsed.activity.filePath,
        confidence: 0.87,
        reasons,
        parsedStrongSignal: false
      }
    );
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
    return finalizeDecision(
      context,
      {
        status: "idle",
        activityText: undefined,
        activityTool: undefined,
        activityPath: undefined,
        confidence: 0.86,
        reasons,
        parsedStrongSignal: evidence.parsedStrongSignal
      }
    );
  }

  if (evidence.strongReasons.length > 0) {
    for (const reason of evidence.strongReasons) {
      pushReason(reason);
    }

    const workingActivity = resolveWorkingActivity(context, evidence);
    return finalizeDecision(
      context,
      {
        status: "working",
        activityText: workingActivity.activityText,
        activityTool: workingActivity.activityTool,
        activityPath: workingActivity.activityPath,
        confidence: 0.88,
        reasons,
        parsedStrongSignal: evidence.parsedStrongSignal
      }
    );
  }

  if (shouldKeepStickyWorking(context, evidence)) {
    pushReason({
      code: "sticky-working-window",
      message: "Keeps working status during a short stabilization window.",
      detail: `${Math.round(context.outputQuietForMs)}ms quiet`
    });

    const workingActivity = resolveWorkingActivity(context, evidence);
    return finalizeDecision(
      context,
      {
        status: "working",
        activityText: workingActivity.activityText,
        activityTool: workingActivity.activityTool,
        activityPath: workingActivity.activityPath,
        confidence: 0.66,
        reasons,
        parsedStrongSignal: evidence.parsedStrongSignal
      }
    );
  }

  if (
    context.worker.status === "working" &&
    evidence.weakReasons.length > 0 &&
    context.outputQuietForMs <= statusFreshnessWindowMs(context)
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
    return finalizeDecision(
      context,
      {
        status: "working",
        activityText: workingActivity.activityText,
        activityTool: workingActivity.activityTool,
        activityPath: workingActivity.activityPath,
        confidence: 0.62,
        reasons,
        parsedStrongSignal: evidence.parsedStrongSignal
      }
    );
  }

  if (evidence.weakReasons.length > 0) {
    for (const reason of evidence.weakReasons) {
      pushReason(reason);
    }

    if (context.commandQuietForMs <= commandWarmupWindowMs) {
      const workingActivity = resolveWorkingActivity(context, evidence);
      return finalizeDecision(
        context,
        {
          status: "working",
          activityText: workingActivity.activityText,
          activityTool: workingActivity.activityTool,
          activityPath: workingActivity.activityPath,
          confidence: 0.56,
          reasons,
          parsedStrongSignal: evidence.parsedStrongSignal
        }
      );
    }
  }

  pushReason({ code: "no-active-evidence", message: "No active work evidence remained within freshness windows." });
  return finalizeDecision(
    context,
    {
      status: "idle",
      activityText: undefined,
      activityTool: undefined,
      activityPath: undefined,
      confidence: 0.74,
      reasons,
      parsedStrongSignal: evidence.parsedStrongSignal
    }
  );
}

function collectWorkingEvidence(context: WorkerStatusSignalContext, hasRecoverableParserError: boolean): WorkingEvidence {
  const strongReasons: StatusReason[] = [];
  const weakReasons: StatusReason[] = [];
  const activityTextCandidates: string[] = [];
  const activityToolCandidates: Array<Worker["activityTool"] | undefined> = [];
  const activityPathCandidates: string[] = [];

  const parsedStrongSignal =
    Boolean(context.parsed.activity.filePath) ||
    (Boolean(context.parsed.activity.tool) && context.parsed.activity.tool !== "terminal");

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

  if (looksLikeActiveRuntimeText(context.runtimeActivityText)) {
    strongReasons.push({ code: "runtime-activity-text", message: "Runtime activity text indicates active work." });
    pushMaybe(activityTextCandidates, context.runtimeActivityText);
  }

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

  return {
    strongReasons,
    weakReasons,
    activityTextCandidates,
    activityToolCandidates,
    activityPathCandidates,
    parsedStrongSignal
  };
}

function detectIdleBlocker(context: WorkerStatusSignalContext, evidence: WorkingEvidence): IdleBlocker | undefined {
  if (context.isOpenCodeSession && context.hasOpenCodePromptSignal && !context.hasOpenCodeActiveSignal) {
    return {
      reason: {
        code: "opencode-prompt-idle",
        message: "OpenCode prompt is visible without active execution signal."
      }
    };
  }

  if (isShellCommand(context.commandLower) && context.transcriptSnapshot?.status !== "working") {
    const hasWorkingEvidence = evidence.strongReasons.length > 0 || evidence.weakReasons.length > 0;
    if (hasWorkingEvidence) {
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
    context.workerAgeMs <= claudeSpawnGraceMs &&
    context.transcriptSnapshot?.status !== "working" &&
    !context.activeClaudeTask &&
    !context.hasClaudeProgressSignal &&
    !evidence.parsedStrongSignal
  ) {
    return {
      reason: {
        code: "claude-spawn-grace-idle",
        message: "During early Claude spawn grace window without active signals.",
        detail: `${Math.round(context.workerAgeMs)}ms since worker creation`
      }
    };
  }

  const activeWindowMs = statusFreshnessWindowMs(context);
  if (context.outputQuietForMs > activeWindowMs && context.transcriptSnapshot?.status !== "working") {
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

function shouldKeepStickyWorking(context: WorkerStatusSignalContext, evidence: WorkingEvidence): boolean {
  if (context.worker.status !== "working") {
    return false;
  }

  if (context.outputQuietForMs > stickyWorkingWindowMs) {
    return false;
  }

  return evidence.strongReasons.length > 0 || evidence.weakReasons.length > 0;
}

function resolveWorkingActivity(
  context: WorkerStatusSignalContext,
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

  const activityPath = firstDefined(...evidence.activityPathCandidates, context.transcriptSnapshot?.activityPath, context.parsed.activity.filePath);

  return {
    activityText: activityText ?? "Working",
    activityTool,
    activityPath
  };
}

function finalizeDecision(
  context: WorkerStatusSignalContext,
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
      isClaudeSession: context.isClaudeSession,
      isOpenCodeSession: context.isOpenCodeSession,
      hasOpenCodePromptSignal: context.hasOpenCodePromptSignal,
      hasOpenCodeActiveSignal: context.hasOpenCodeActiveSignal,
      hasClaudeProgressSignal: context.hasClaudeProgressSignal,
      hasActiveClaudeTask: Boolean(context.activeClaudeTask),
      hasRuntimeActivityText: Boolean(context.runtimeActivityText),
      hasParsedStrongSignal: partial.parsedStrongSignal,
      hasParsedNeedsInput: context.parsed.activity.needsInput,
      hasParsedError: context.parsed.activity.hasError
    }
  };
}

function classifyParserError(context: WorkerStatusSignalContext): ParserErrorClassification {
  const hasRecentParserErrorSignal = context.parsed.activity.hasError && context.outputQuietForMs <= recentErrorSignalWindowMs;
  if (!hasRecentParserErrorSignal) {
    return "none";
  }

  if (!isAgentRuntime(context)) {
    return "fatal";
  }

  if (hasRecentFatalRuntimeError(context.output)) {
    return "fatal";
  }

  if (hasRecoverableAgentToolError(context)) {
    return "recoverable";
  }

  if (context.worker.status === "working" && context.outputQuietForMs <= stickyWorkingWindowMs) {
    return "recoverable";
  }

  return "recoverable";
}

function hasRecentFatalRuntimeError(output: string): boolean {
  return recentNormalizedLines(output, 30).some((line) => fatalRuntimeErrorMatchers.some((matcher) => matcher.test(line)));
}

function hasRecoverableAgentToolError(context: WorkerStatusSignalContext): boolean {
  const recentLines = recentNormalizedLines(context.output, 40);

  if (recentLines.some((line) => recoverableToolErrorMatchers.some((matcher) => matcher.test(line)))) {
    return true;
  }

  const hasLikelyWebToolContext =
    context.parsed.activity.tool === "web" ||
    recentLines.some((line) =>
      /\b(?:webfetch|read-url|curl|wget|http:\/\/|https:\/\/|status code\s*:?\s*\d{3})\b/i.test(line)
    );

  if (hasLikelyWebToolContext && recentLines.some((line) => /^error:\s+/i.test(line))) {
    return true;
  }

  return false;
}

function recentNormalizedLines(output: string, limit: number): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-limit)
    .map((line) => line.toLowerCase());
}

function isAgentRuntime(context: WorkerStatusSignalContext): boolean {
  return context.isOpenCodeSession || context.isClaudeSession;
}

function looksLikeActiveRuntimeText(activityText: string | undefined): boolean {
  if (!activityText) {
    return false;
  }

  if (hasWaitingActivityText(activityText)) {
    return false;
  }

  const normalized = activityText.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (hasActiveWorkActivityText(activityText)) {
    return true;
  }

  return (
    normalized.startsWith("thinking") ||
    normalized.startsWith("responding") ||
    normalized.startsWith("running") ||
    normalized.startsWith("editing") ||
    normalized.startsWith("reading") ||
    normalized.startsWith("writing")
  );
}

function statusFreshnessWindowMs(context: WorkerStatusSignalContext): number {
  if (context.isClaudeSession) {
    return claudeWorkingFreshWindowMs;
  }

  if (context.isOpenCodeSession) {
    return openCodeWorkingFreshWindowMs;
  }

  return genericWorkingFreshWindowMs;
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
