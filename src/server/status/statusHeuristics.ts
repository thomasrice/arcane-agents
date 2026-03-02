import type { Worker } from "../../shared/types";
import type { ParsedActivity } from "./activityParser";
import type { PaneObservation } from "./paneObservation";
import {
  hasActiveWorkActivityText,
  hasClaudeLiveProgressSignal,
  hasOpenCodeActiveSignal,
  hasOpenCodePromptSignal,
  hasWaitingActivityText,
  isGenericClaudeProgressLabel,
  isLikelyClaudeSession,
  isLikelyOpenCodeSession
} from "./runtimeSignals";

const shellCommands = new Set(["bash", "zsh", "fish", "sh", "nu", "pwsh"]);
const nonShellIdleAfterMs = 10_000;
const outputHeartbeatWorkingWindowMs = 12_000;
const claudeStickyWorkingWindowMs = 10_000;
const claudeActiveTextHoldWindowMs = 5 * 60_000;
const claudeSpawnIdleGraceMs = 5_000;

export function resolveFallbackStatus(
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

  const hasStrongActivitySignal = Boolean(activity.filePath) || (Boolean(activity.tool) && activity.tool !== "terminal");

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

export function shouldKeepWorkingFromHeartbeat(
  worker: Worker,
  currentCommand: string,
  observation: PaneObservation,
  activity: ParsedActivity,
  activeClaudeTask: string | undefined,
  activityText: string | undefined,
  output: string
): boolean {
  const now = Date.now();
  const commandLower = currentCommand.toLowerCase();
  const likelyClaudeSession = isLikelyClaudeSession(worker, commandLower);
  const likelyOpenCodeSession = isLikelyOpenCodeSession(worker, commandLower);
  const outputQuietForMs = now - observation.lastOutputChangeAtMs;
  const hasClaudeProgressSignal = likelyClaudeSession && hasClaudeLiveProgressSignal(output);

  if (likelyOpenCodeSession && hasOpenCodePromptSignal(output) && !hasOpenCodeActiveSignal(output)) {
    return false;
  }

  if (
    likelyClaudeSession &&
    hasActiveWorkActivityText(activityText) &&
    !hasWaitingActivityText(activityText) &&
    (Boolean(activeClaudeTask) || hasClaudeProgressSignal) &&
    outputQuietForMs <= claudeActiveTextHoldWindowMs
  ) {
    return true;
  }

  const heartbeatWindowMs = likelyClaudeSession ? claudeStickyWorkingWindowMs : outputHeartbeatWorkingWindowMs;
  if (outputQuietForMs > heartbeatWindowMs) {
    return false;
  }

  if (likelyClaudeSession) {
    return Boolean(activeClaudeTask || hasClaudeProgressSignal);
  }

  if (!shellCommands.has(commandLower)) {
    return true;
  }

  if (activeClaudeTask) {
    return true;
  }

  if (worker.status === "working") {
    return true;
  }

  return Boolean(activity.filePath || activity.tool || activity.text);
}

export function shouldTreatAsSpawnGraceIdle(
  worker: Worker,
  currentCommand: string,
  activity: ParsedActivity,
  activeClaudeTask: string | undefined
): boolean {
  const createdAtMs = Date.parse(worker.createdAt);
  if (!Number.isFinite(createdAtMs)) {
    return false;
  }

  const ageMs = Date.now() - createdAtMs;
  if (ageMs < 0 || ageMs > claudeSpawnIdleGraceMs) {
    return false;
  }

  if (!isLikelyClaudeSession(worker, currentCommand.toLowerCase())) {
    return false;
  }

  if (activeClaudeTask || activity.needsInput || activity.hasError) {
    return false;
  }

  const hasStrongActivitySignal = Boolean(activity.filePath) || (Boolean(activity.tool) && activity.tool !== "terminal");

  return !hasStrongActivitySignal;
}

export function shouldPromoteIdleFromActiveClaudeTask(
  worker: Worker,
  currentCommand: string,
  observation: PaneObservation,
  activeClaudeTask: string | undefined
): boolean {
  if (!activeClaudeTask) {
    return false;
  }

  if (!isLikelyClaudeSession(worker, currentCommand.toLowerCase())) {
    return true;
  }

  const outputQuietForMs = Date.now() - observation.lastOutputChangeAtMs;
  return outputQuietForMs <= claudeStickyWorkingWindowMs;
}

export function shouldForceIdleOnOpenCodePrompt(
  worker: Worker,
  currentCommand: string,
  output: string,
  activity: ParsedActivity
): boolean {
  if (!isLikelyOpenCodeSession(worker, currentCommand.toLowerCase())) {
    return false;
  }

  if (!hasOpenCodePromptSignal(output)) {
    return false;
  }

  if (hasOpenCodeActiveSignal(output)) {
    return false;
  }

  if (activity.needsInput) {
    return false;
  }

  return true;
}

export function shouldDowngradeAttentionToWorking(
  worker: Worker,
  currentCommand: string,
  observation: PaneObservation,
  activity: ParsedActivity,
  activeClaudeTask: string | undefined,
  activityText: string | undefined,
  output: string
): boolean {
  const normalizedActivityText = (activityText ?? "").toLowerCase();
  if (normalizedActivityText.includes("waiting for your answer") || normalizedActivityText.includes("waiting for approval")) {
    return false;
  }

  const likelyClaudeSession = isLikelyClaudeSession(worker, currentCommand.toLowerCase());
  const hasClaudeProgressSignal = likelyClaudeSession && hasClaudeLiveProgressSignal(output);

  if (activity.needsInput && !hasClaudeProgressSignal) {
    return false;
  }

  if (likelyClaudeSession && (Boolean(activeClaudeTask) || hasClaudeProgressSignal)) {
    return true;
  }

  return shouldKeepWorkingFromHeartbeat(worker, currentCommand, observation, activity, activeClaudeTask, activityText, output);
}

export function shouldForceIdleOnStaleClaudeProgress(
  worker: Worker,
  currentCommand: string,
  observation: PaneObservation,
  activityText: string | undefined
): boolean {
  if (!isLikelyClaudeSession(worker, currentCommand.toLowerCase())) {
    return false;
  }

  if (!activityText) {
    return false;
  }

  const normalized = activityText.trim();
  if (!normalized) {
    return false;
  }

  const looksLikeTransientProgress = isGenericClaudeProgressLabel(normalized) || /\bfor\s+\d+\s*[ms]\b/i.test(normalized);
  if (!looksLikeTransientProgress) {
    return false;
  }

  const outputQuietForMs = Date.now() - observation.lastOutputChangeAtMs;
  return outputQuietForMs > claudeStickyWorkingWindowMs;
}
