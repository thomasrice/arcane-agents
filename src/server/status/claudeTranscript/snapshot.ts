import { activeToolStaleAfterMs, permissionExemptTools, permissionIdleDelayMs } from "./constants";
import { normalizeToolName } from "./accumulator";
import type { ActiveToolEntry, ClaudeStatusSnapshot, ClaudeTranscriptState } from "./types";

export function buildSnapshot(state: ClaudeTranscriptState, nowMs: number): ClaudeStatusSnapshot | undefined {
  if (!state.seenTranscriptRecord) {
    return undefined;
  }

  const activeTools = listFreshActiveTools(state, nowMs);
  const mostRecentTool = activeTools.reduce<ActiveToolEntry | undefined>((latest, current) => {
    if (!latest) {
      return current;
    }

    if (current.lastProgressAtMs >= latest.lastProgressAtMs) {
      return current;
    }

    return latest;
  }, undefined);

  const hasAskUserQuestion = activeTools.some((entry) => normalizeToolName(entry.toolName) === "askuserquestion");
  const hasNonExemptActiveTools = activeTools.some((entry) => !permissionExemptTools.has(normalizeToolName(entry.toolName)));

  const isPermissionWait = hasNonExemptActiveTools && nowMs - state.lastEventAtMs >= permissionIdleDelayMs;
  const isActivelyWorking = activeTools.length > 0 || nowMs <= state.busyUntilMs;

  let status: ClaudeStatusSnapshot["status"] = "idle";
  if (hasAskUserQuestion || isPermissionWait) {
    status = "attention";
  } else if (isActivelyWorking && !state.waiting) {
    status = "working";
  } else {
    status = "idle";
  }

  let activityText = mostRecentTool?.statusText ?? state.lastActivityText;
  let activityTool = mostRecentTool?.activityTool ?? state.lastActivityTool;
  let activityPath = mostRecentTool?.activityPath ?? state.lastActivityPath;

  if (hasAskUserQuestion) {
    activityText = "Waiting for your answer";
    activityTool = "terminal";
  } else if (isPermissionWait) {
    activityText = activityText ?? "Waiting for approval";
    activityTool = activityTool ?? "terminal";
  }

  if (status === "idle" && activityText === "Waiting for approval") {
    activityText = undefined;
    activityTool = undefined;
    activityPath = undefined;
  }

  return {
    status,
    activityText,
    activityTool,
    activityPath
  };
}

function listActiveTools(state: ClaudeTranscriptState): ActiveToolEntry[] {
  const entries: ActiveToolEntry[] = [];

  for (const entry of state.activeTools.values()) {
    entries.push(entry);
  }

  for (const subagentTools of state.activeSubagentTools.values()) {
    for (const entry of subagentTools.values()) {
      entries.push(entry);
    }
  }

  return entries;
}

function listFreshActiveTools(state: ClaudeTranscriptState, nowMs: number): ActiveToolEntry[] {
  const entries = listActiveTools(state);
  if (entries.length === 0) {
    return entries;
  }

  if (state.lastEventAtMs <= 0) {
    return entries;
  }

  const transcriptQuietForMs = nowMs - state.lastEventAtMs;
  if (transcriptQuietForMs <= activeToolStaleAfterMs) {
    return entries;
  }

  return entries.filter((entry) => nowMs - entry.lastProgressAtMs <= activeToolStaleAfterMs);
}
