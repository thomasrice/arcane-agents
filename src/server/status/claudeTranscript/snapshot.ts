import { activeToolStaleAfterMs } from "./constants";
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

  const isActivelyWorking = activeTools.length > 0 || nowMs <= state.busyUntilMs;

  let status: ClaudeStatusSnapshot["status"] = "idle";
  if (hasAskUserQuestion) {
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

  // An active tool is only ever "touched" by a transcript event, so no tool can be
  // fresher than the last transcript event (entry.lastProgressAtMs <= lastEventAtMs).
  // Once the transcript itself has been quiet beyond the stale window, every active
  // tool is therefore stale too — so drop them all. (This replaces a per-tool
  // `nowMs - entry.lastProgressAtMs` filter that was provably dead: it was only ever
  // reached in this same transcript-quiet-beyond-stale case, where it filtered out
  // every entry anyway.)
  const transcriptQuietForMs = nowMs - state.lastEventAtMs;
  if (transcriptQuietForMs > activeToolStaleAfterMs) {
    return [];
  }

  return entries;
}
