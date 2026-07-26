import type { Worker } from "../../shared/types";
import { TmuxAdapter } from "../tmux/tmuxAdapter";
import { parseActivity, type ParsedActivity } from "./activityParser";
import { observePane, type PaneObservation } from "./paneObservation";
import {
  ClaudeTranscriptTracker,
  type ClaudeStatusSnapshot,
  type ClaudeTranscriptAttachment,
  type TranscriptHealth
} from "./claudeTranscriptTracker";
import { resolveRuntimeAdapter, type RuntimeAdapter, type RuntimeSignals } from "./runtimes/adapter";
import { resolvePaneAgentRuntimeProcess, type AgentRuntimeProcess } from "./runtimes/runtimeProcess";
import {
  matchCustomStatusRule,
  type CompiledStatusRules,
  type CustomStatusRuleMatch
} from "./customStatusRules";
import {
  matchPromptSignature,
  type CompiledPromptSignatures,
  type PromptSignatureMatch
} from "./promptSignatures";

/**
 * Everything the decision step needs, derived from ONE pass over the captured
 * pane output. The old per-runtime boolean triples collapse into a single
 * resolved `runtime` adapter plus its detected `runtimeSignals`.
 */
export interface WorkerSignals {
  currentCommand: string;
  commandLower: string;
  output: string;
  visibleOutput?: string;
  observation: PaneObservation;
  transcriptSnapshot: ClaudeStatusSnapshot | undefined;
  transcriptAttachment?: ClaudeTranscriptAttachment;
  parsed: { activity: ParsedActivity };
  runtime: RuntimeAdapter;
  runtimeSignals: RuntimeSignals;
  promptSignature: PromptSignatureMatch | undefined;
  activeRuntimeProcess: AgentRuntimeProcess | undefined;
  transcriptHealth: TranscriptHealth;
  interactiveCommands: ReadonlySet<string>;
  runtimeFreshnessWindowMs: number | undefined;
  customStatusRule: CustomStatusRuleMatch | undefined;
}

/** Raw pane inputs the pure signal-derivation and decision work over. */
export interface EvaluateWorkerStatusInput {
  worker: Worker;
  currentCommand: string;
  output: string;
  /** Current visible tmux pane only; prompt signatures never inspect scrollback. */
  visibleOutput?: string;
  observation: PaneObservation;
  transcriptSnapshot: ClaudeStatusSnapshot | undefined;
  /** Optional; defaults from whether a snapshot is present (test convenience). */
  transcriptHealth?: TranscriptHealth;
  transcriptAttachment?: ClaudeTranscriptAttachment;
  runtimeProcess: AgentRuntimeProcess | undefined;
  interactiveCommands: ReadonlySet<string>;
  runtimeFreshnessWindowMs: number | undefined;
  customStatusRules?: CompiledStatusRules;
  promptSignatures?: CompiledPromptSignatures;
}

interface CollectSignalsInput {
  worker: Worker;
  tmux: TmuxAdapter;
  paneObservation: Map<string, PaneObservation>;
  claudeTranscript: ClaudeTranscriptTracker;
  interactiveCommands: ReadonlySet<string>;
  runtimeFreshnessWindowMs: number | undefined;
  customStatusRules: CompiledStatusRules;
  promptSignatures: CompiledPromptSignatures;
}


/**
 * Pure: turn raw pane inputs into the decision-ready signal set. Resolves the
 * single runtime adapter (consulting output for the generic-escalation tiebreak)
 * and runs its detector once.
 */
export function buildWorkerSignals(input: EvaluateWorkerStatusInput): WorkerSignals {
  const commandLower = input.currentCommand.toLowerCase();
  const wrappedRuntime = input.runtimeProcess?.runtime;
  const candidatePromptSignature =
    input.promptSignatures && input.visibleOutput !== undefined
      ? matchPromptSignature(input.promptSignatures, input.visibleOutput)
      : undefined;
  const runtime = resolveRuntimeAdapter(
    input.worker,
    commandLower,
    wrappedRuntime,
    input.output,
    candidatePromptSignature?.runtime
  );
  const promptSignature =
    candidatePromptSignature?.runtime === runtime.id ? candidatePromptSignature : undefined;
  const nativeRuntimeSignals = runtime.detect(input.output);
  const runtimeSignals =
    promptSignature === undefined
      ? nativeRuntimeSignals
      : { ...nativeRuntimeSignals, prompt: true };

  const customStatusRule = input.customStatusRules
    ? matchCustomStatusRule(input.customStatusRules, {
        worker: input.worker,
        currentCommand: input.currentCommand,
        output: input.output
      })
    : undefined;
  return {
    currentCommand: input.currentCommand,
    commandLower,
    output: input.output,
    observation: input.observation,
    transcriptSnapshot: input.transcriptSnapshot,
    transcriptAttachment: input.transcriptAttachment,
    visibleOutput: input.visibleOutput,
    parsed: parseActivity(input.currentCommand, input.output),
    runtime,
    promptSignature,
    runtimeSignals,
    activeRuntimeProcess: input.runtimeProcess,
    transcriptHealth: input.transcriptHealth ?? (input.transcriptSnapshot ? "ok" : "absent"),
    interactiveCommands: input.interactiveCommands,
    runtimeFreshnessWindowMs: input.runtimeFreshnessWindowMs,
    customStatusRule
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
  runtimeFreshnessWindowMs,
  customStatusRules,
  promptSignatures
}: CollectSignalsInput): Promise<WorkerSignals | undefined> {
  const paneState = await tmux.getPaneState(worker.tmuxRef);
  if (paneState.isDead) {
    return undefined;
  }

  const commandLower = paneState.currentCommand.toLowerCase();
  const runtimeProcess = await resolvePaneAgentRuntimeProcess(paneState.panePid, commandLower);

  // Capture-time adapter uses the definite classification only (no output yet).
  const captureAdapter = resolveRuntimeAdapter(worker, commandLower, runtimeProcess?.runtime);

  // The transcript poll now consumes a pane-changed signal (for activity-
  // correlation attach), so it can no longer run parallel to the capture: we must
  // capture the pane and fold it into the observation first. `observePane` mutates
  // one PaneObservation per worker in place, so read the prior change time before
  // it updates.
  const previousOutputChangeAtMs = paneObservation.get(worker.id)?.lastOutputChangeAtMs;
  const [output, visibleOutput] = await Promise.all([
    tmux.capturePane(worker.tmuxRef, captureAdapter.captureLines),
    promptSignatures.length > 0 ? tmux.captureVisiblePane(worker.tmuxRef) : Promise.resolve(undefined)
  ]);
  const observation = observePane(paneObservation, worker.id, paneState.currentCommand, output);
  const paneOutputChanged =
    previousOutputChangeAtMs !== undefined && observation.lastOutputChangeAtMs !== previousOutputChangeAtMs;

  const transcript = await claudeTranscript.poll(
    worker,
    paneState.currentCommand,
    paneState.currentPath,
    paneState.panePid,
    { paneOutputChanged }
  );

  return buildWorkerSignals({
    worker,
    currentCommand: paneState.currentCommand,
    output,
    observation,
    visibleOutput,
    transcriptSnapshot: transcript.snapshot,
    transcriptHealth: transcript.health,
    transcriptAttachment: transcript.attachment,
    runtimeProcess,
    interactiveCommands,
    runtimeFreshnessWindowMs,
    customStatusRules,
    promptSignatures
  });
}
