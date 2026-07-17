import type { Worker } from "../../shared/types";
import { TmuxAdapter } from "../tmux/tmuxAdapter";
import { parseActivity, type ParsedActivity } from "./activityParser";
import { observePane, type PaneObservation } from "./paneObservation";
import { ClaudeTranscriptTracker, type ClaudeStatusSnapshot, type TranscriptHealth } from "./claudeTranscriptTracker";
import { resolveRuntimeAdapter, type RuntimeAdapter, type RuntimeSignals } from "./runtimes/adapter";
import { findAgentRuntimeProcess, type AgentRuntimeProcess } from "./runtimes/runtimeProcess";

/**
 * Everything the decision step needs, derived from ONE pass over the captured
 * pane output. The old per-runtime boolean triples collapse into a single
 * resolved `runtime` adapter plus its detected `runtimeSignals`.
 */
export interface WorkerSignals {
  currentCommand: string;
  commandLower: string;
  output: string;
  observation: PaneObservation;
  transcriptSnapshot: ClaudeStatusSnapshot | undefined;
  parsed: { activity: ParsedActivity };
  runtime: RuntimeAdapter;
  runtimeSignals: RuntimeSignals;
  activeRuntimeProcess: AgentRuntimeProcess | undefined;
  transcriptHealth: TranscriptHealth;
  interactiveCommands: ReadonlySet<string>;
  runtimeFreshnessWindowMs: number | undefined;
}

/** Raw pane inputs the pure signal-derivation and decision work over. */
export interface EvaluateWorkerStatusInput {
  worker: Worker;
  currentCommand: string;
  output: string;
  observation: PaneObservation;
  transcriptSnapshot: ClaudeStatusSnapshot | undefined;
  /** Optional; defaults from whether a snapshot is present (test convenience). */
  transcriptHealth?: TranscriptHealth;
  runtimeProcess: AgentRuntimeProcess | undefined;
  interactiveCommands: ReadonlySet<string>;
  runtimeFreshnessWindowMs: number | undefined;
}

interface CollectSignalsInput {
  worker: Worker;
  tmux: TmuxAdapter;
  paneObservation: Map<string, PaneObservation>;
  claudeTranscript: ClaudeTranscriptTracker;
  interactiveCommands: ReadonlySet<string>;
  runtimeFreshnessWindowMs: number | undefined;
}

const wrappedShellCommands = new Set(["bash", "zsh", "sh"]);

/**
 * Pure: turn raw pane inputs into the decision-ready signal set. Resolves the
 * single runtime adapter (consulting output for the generic-escalation tiebreak)
 * and runs its detector once.
 */
export function buildWorkerSignals(input: EvaluateWorkerStatusInput): WorkerSignals {
  const commandLower = input.currentCommand.toLowerCase();
  const wrappedRuntime = input.runtimeProcess?.runtime;
  const runtime = resolveRuntimeAdapter(input.worker, commandLower, wrappedRuntime, input.output);

  return {
    currentCommand: input.currentCommand,
    commandLower,
    output: input.output,
    observation: input.observation,
    transcriptSnapshot: input.transcriptSnapshot,
    parsed: parseActivity(input.currentCommand, input.output),
    runtime,
    runtimeSignals: runtime.detect(input.output),
    activeRuntimeProcess: input.runtimeProcess,
    transcriptHealth: input.transcriptHealth ?? (input.transcriptSnapshot ? "ok" : "absent"),
    interactiveCommands: input.interactiveCommands,
    runtimeFreshnessWindowMs: input.runtimeFreshnessWindowMs
  };
}

/**
 * Async: read the live pane, wrapped-process, transcript, and capture output,
 * then derive the signal set. Returns undefined when the pane is dead (the
 * worker should be removed).
 */
export async function collectSignals({
  worker,
  tmux,
  paneObservation,
  claudeTranscript,
  interactiveCommands,
  runtimeFreshnessWindowMs
}: CollectSignalsInput): Promise<WorkerSignals | undefined> {
  const paneState = await tmux.getPaneState(worker.tmuxRef);
  if (paneState.isDead) {
    return undefined;
  }

  const commandLower = paneState.currentCommand.toLowerCase();
  const runtimeProcess =
    paneState.panePid && wrappedShellCommands.has(commandLower)
      ? await findAgentRuntimeProcess(paneState.panePid)
      : undefined;

  // Capture-time adapter uses the definite classification only (no output yet).
  const captureAdapter = resolveRuntimeAdapter(worker, commandLower, runtimeProcess?.runtime);

  const [output, transcript] = await Promise.all([
    tmux.capturePane(worker.tmuxRef, captureAdapter.captureLines),
    claudeTranscript.poll(worker, paneState.currentCommand, paneState.currentPath, paneState.panePid)
  ]);

  const observation = observePane(paneObservation, worker.id, paneState.currentCommand, output);

  return buildWorkerSignals({
    worker,
    currentCommand: paneState.currentCommand,
    output,
    observation,
    transcriptSnapshot: transcript.snapshot,
    transcriptHealth: transcript.health,
    runtimeProcess,
    interactiveCommands,
    runtimeFreshnessWindowMs
  });
}
