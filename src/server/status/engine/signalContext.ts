import type { Worker } from "../../../shared/types";
import { parseActivity } from "../activityParser";
import type { ClaudeStatusSnapshot } from "../claudeTranscriptTracker";
import type { PaneObservation } from "../paneObservation";
import type { AgentRuntimeProcess } from "../runtime/runtimeProcess";
import {
  detectClaudeSignals,
  detectCodexSignals,
  detectOpenCodeSignals,
  extractClaudeActiveTask,
  extractRuntimeActivityText,
  isLikelyClaudeSession,
  isLikelyCodexSession,
  isLikelyOpenCodeSession
} from "../runtimeSignals";
import type { WorkerStatusSignalContext } from "./types";

interface BuildWorkerStatusSignalContextInput {
  worker: Worker;
  currentCommand: string;
  output: string;
  observation: PaneObservation;
  transcriptSnapshot: ClaudeStatusSnapshot | undefined;
  runtimeProcess: AgentRuntimeProcess | undefined;
  nowMs: number;
  interactiveCommands: ReadonlySet<string>;
}

export function buildWorkerStatusSignalContext({
  worker,
  currentCommand,
  output,
  observation,
  transcriptSnapshot,
  runtimeProcess,
  nowMs,
  interactiveCommands
}: BuildWorkerStatusSignalContextInput): WorkerStatusSignalContext {
  const parsed = parseActivity(currentCommand, output);
  const commandLower = currentCommand.toLowerCase();
  const wrappedRuntime = runtimeProcess?.runtime;
  const isClaude = wrappedRuntime === "claude" || isLikelyClaudeSession(worker, commandLower);
  const claudeSignals = detectClaudeSignals(output);
  const openCodeSignals = detectOpenCodeSignals(output);
  const codexSignals = detectCodexSignals(output);
  const isOpenCode =
    wrappedRuntime === "opencode" || isLikelyOpenCodeSession(worker, commandLower) || openCodeSignals.prompt || openCodeSignals.active;
  const isCodex =
    wrappedRuntime === "codex" || isLikelyCodexSession(worker, commandLower) || codexSignals.prompt || codexSignals.active;
  const runtimeActivityText = extractRuntimeActivityText(output, { isClaude, isOpenCode, isCodex });
  const activeClaudeTask = isClaude ? extractClaudeActiveTask(output) : undefined;
  const hasClaudePromptSignal = isClaude && claudeSignals.prompt;
  const hasClaudeProgressSignal = isClaude && claudeSignals.active;
  const openCodePromptSignal = isOpenCode && openCodeSignals.prompt;
  const openCodeActiveSignal = isOpenCode && openCodeSignals.active;
  const codexPromptSignal = isCodex && codexSignals.prompt;
  const codexActiveSignal = isCodex && codexSignals.active;
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
    activeRuntimeProcess: runtimeProcess,
    hasClaudePromptSignal,
    hasClaudeProgressSignal,
    hasOpenCodePromptSignal: openCodePromptSignal,
    hasOpenCodeActiveSignal: openCodeActiveSignal,
    hasCodexPromptSignal: codexPromptSignal,
    hasCodexActiveSignal: codexActiveSignal,
    isClaudeSession: isClaude,
    isOpenCodeSession: isOpenCode,
    isCodexSession: isCodex,
    outputQuietForMs,
    commandQuietForMs,
    workerAgeMs,
    interactiveCommands
  };
}
