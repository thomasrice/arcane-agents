import type { Worker } from "../../../../shared/types";
import { hasActiveWorkActivityText } from "../../runtimeSignals";
import type { StatusReason, WorkerStatusSignalContext } from "../types";
import { cachedActivityWindowMs, commandWarmupWindowMs, parsedStrongEvidenceWindowMs, stickyWorkingWindowMs } from "./constants";
import {
  hasAnyWorkingEvidence,
  isInteractiveCommand,
  isShellCommand,
  looksLikeActiveRuntimeText,
  pushMaybe,
  shouldSuppressShellHistorySignals
} from "./helpers";
import type { WorkingEvidence } from "./types";

function collectWorkingEvidence(context: WorkerStatusSignalContext, hasRecoverableParserError: boolean): WorkingEvidence {
  const strongReasons: StatusReason[] = [];
  const weakReasons: StatusReason[] = [];
  const activityTextCandidates: string[] = [];
  const activityToolCandidates: Array<Worker["activityTool"] | undefined> = [];
  const activityPathCandidates: string[] = [];

  const suppressShellHistorySignals = shouldSuppressShellHistorySignals(context);

  const transcriptIsIdle = context.transcriptSnapshot !== undefined && context.transcriptSnapshot.status !== "working";

  const parsedStrongSignal =
    !suppressShellHistorySignals &&
    !transcriptIsIdle &&
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

  if (context.activeRuntimeProcess) {
    strongReasons.push({
      code: "agent-runtime-child-process",
      message: `${labelRuntime(context.activeRuntimeProcess.runtime)} is still running under the pane shell.`
    });
    activityTextCandidates.push(context.runtimeActivityText ?? `${labelRuntime(context.activeRuntimeProcess.runtime)} running`);
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

  return {
    strongReasons,
    weakReasons,
    activityTextCandidates,
    activityToolCandidates,
    activityPathCandidates,
    parsedStrongSignal
  };
}

function shouldKeepStickyWorking(context: WorkerStatusSignalContext, evidence: WorkingEvidence): boolean {
  if (context.worker.status !== "working") {
    return false;
  }

  if (context.outputQuietForMs > stickyWorkingWindowMs) {
    return false;
  }

  return hasAnyWorkingEvidence(evidence);
}

function labelRuntime(runtime: "claude" | "opencode" | "codex"): string {
  switch (runtime) {
    case "claude":
      return "Claude";
    case "opencode":
      return "OpenCode";
    case "codex":
      return "Codex";
  }
}

export { collectWorkingEvidence, shouldKeepStickyWorking };
