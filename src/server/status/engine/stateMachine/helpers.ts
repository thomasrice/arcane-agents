import { hasActiveWorkActivityText, hasWaitingActivityText } from "../../runtimeSignals";
import { shellCommands, type WorkerStatusSignalContext } from "../types";
import {
  claudeWorkingFreshWindowMs,
  genericWorkingFreshWindowMs,
  openCodeWorkingFreshWindowMs,
  shellPromptTailMatchers
} from "./constants";
import type { WorkingEvidence } from "./types";

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

function shouldSuppressShellHistorySignals(context: WorkerStatusSignalContext): boolean {
  if (!isShellCommand(context.commandLower)) {
    return false;
  }

  if (isAgentRuntime(context)) {
    return false;
  }

  return hasLikelyInteractiveShellPrompt(context.output);
}

function hasLikelyInteractiveShellPrompt(output: string): boolean {
  const lines = output
    .split("\n")
    .map((line) => normalizePromptLine(line))
    .filter((line) => line.length > 0)
    .slice(-6)
    .reverse();

  for (const line of lines) {
    if (shellPromptTailMatchers.some((matcher) => matcher.test(line))) {
      return true;
    }

    return false;
  }

  return false;
}

function normalizePromptLine(line: string): string {
  return line.replace(/^[\s│┃╹▀▣⬝■]+/, "").trim();
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

  return normalized.startsWith("thinking");
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

function hasAnyWorkingEvidence(evidence: WorkingEvidence): boolean {
  return evidence.strongReasons.length > 0 || evidence.weakReasons.length > 0;
}

export {
  recentNormalizedLines,
  isAgentRuntime,
  shouldSuppressShellHistorySignals,
  hasLikelyInteractiveShellPrompt,
  normalizePromptLine,
  looksLikeActiveRuntimeText,
  statusFreshnessWindowMs,
  isShellCommand,
  pushMaybe,
  firstDefined,
  hasAnyWorkingEvidence
};
