import type { Worker } from "../../../shared/types";
import { parseActivity } from "../activityParser";
import type { ClaudeStatusSnapshot } from "../claudeTranscriptTracker";
import type { PaneObservation } from "../paneObservation";
import {
  extractClaudeActiveTask,
  extractRuntimeActivityText,
  hasClaudeLiveProgressSignal,
  hasOpenCodeActiveSignal,
  hasOpenCodePromptSignal,
  isLikelyClaudeSession,
  isLikelyOpenCodeSession
} from "../runtimeSignals";
import type { WorkerStatusSignalContext } from "./types";

interface BuildWorkerStatusSignalContextInput {
  worker: Worker;
  currentCommand: string;
  output: string;
  observation: PaneObservation;
  transcriptSnapshot: ClaudeStatusSnapshot | undefined;
  nowMs: number;
}

export function buildWorkerStatusSignalContext({
  worker,
  currentCommand,
  output,
  observation,
  transcriptSnapshot,
  nowMs
}: BuildWorkerStatusSignalContextInput): WorkerStatusSignalContext {
  const parsed = parseActivity(currentCommand, output);
  const commandLower = currentCommand.toLowerCase();
  const isClaude = isLikelyClaudeSession(worker, commandLower);
  const rawOpenCodePromptSignal = hasOpenCodePromptSignal(output);
  const rawOpenCodeActiveSignal = hasOpenCodeActiveSignal(output);
  const isOpenCode = isLikelyOpenCodeSession(worker, commandLower) || rawOpenCodePromptSignal || rawOpenCodeActiveSignal;
  const runtimeActivityText = extractRuntimeActivityText(worker, currentCommand, output);
  const activeClaudeTask = extractClaudeActiveTask(output);
  const hasClaudeProgressSignal = isClaude && hasClaudeLiveProgressSignal(output);
  const openCodePromptSignal = isOpenCode && rawOpenCodePromptSignal;
  const openCodeActiveSignal = isOpenCode && rawOpenCodeActiveSignal;
  const outputQuietForMs = Math.max(0, nowMs - observation.lastOutputChangeAtMs);
  const commandQuietForMs = Math.max(0, nowMs - observation.lastCommandChangeAtMs);
  const createdAtMs = Date.parse(worker.createdAt);
  const workerAgeMs = Number.isFinite(createdAtMs) ? Math.max(0, nowMs - createdAtMs) : Number.POSITIVE_INFINITY;

  return {
    worker,
    nowMs,
    currentCommand,
    commandLower,
    output,
    observation,
    transcriptSnapshot,
    parsed,
    runtimeActivityText,
    activeClaudeTask,
    hasClaudeProgressSignal,
    hasOpenCodePromptSignal: openCodePromptSignal,
    hasOpenCodeActiveSignal: openCodeActiveSignal,
    isClaudeSession: isClaude,
    isOpenCodeSession: isOpenCode,
    outputQuietForMs,
    commandQuietForMs,
    workerAgeMs
  };
}
