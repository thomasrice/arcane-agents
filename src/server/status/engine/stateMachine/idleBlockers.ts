import type { WorkerStatusSignalContext } from "../types";
import { claudeSpawnGraceMs, openCodeSpawnGraceMs } from "./constants";
import { hasAnyWorkingEvidence, isShellCommand, statusFreshnessWindowMs } from "./helpers";
import type { IdleBlocker, WorkingEvidence } from "./types";

function isPromptDominantOpenCodeIdle(context: WorkerStatusSignalContext): boolean {
  return context.isOpenCodeSession && context.hasOpenCodePromptSignal && !context.hasOpenCodeActiveSignal;
}

function detectIdleBlocker(context: WorkerStatusSignalContext, evidence: WorkingEvidence): IdleBlocker | undefined {
  if (isPromptDominantOpenCodeIdle(context)) {
    return {
      reason: {
        code: "opencode-prompt-idle",
        message: "OpenCode prompt is visible without a fresh active execution signal."
      }
    };
  }

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

  if (
    context.isOpenCodeSession &&
    context.workerAgeMs <= openCodeSpawnGraceMs &&
    context.transcriptSnapshot?.status !== "working" &&
    !context.hasOpenCodeActiveSignal &&
    !evidence.parsedStrongSignal
  ) {
    return {
      reason: {
        code: "opencode-spawn-grace-idle",
        message: "During early OpenCode spawn grace window without active signals.",
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

export { detectIdleBlocker, isPromptDominantOpenCodeIdle };
