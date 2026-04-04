import type { Worker } from "../../shared/types";
import { TmuxAdapter } from "../tmux/tmuxAdapter";
import { capturePaneLineCount } from "./runtimeSignals";
import type { AgentRuntimeProcess } from "./runtime/runtimeProcess";
import { findAgentRuntimeProcess } from "./runtime/runtimeProcess";
import { evaluateWorkerStatus } from "./statusEvaluator";
import { observePane, type PaneObservation } from "./paneObservation";
import { ClaudeTranscriptTracker, type ClaudeStatusSnapshot } from "./claudeTranscriptTracker";
import type { StatusDecisionFacts, StatusReason } from "./engine/types";

export interface WorkerStatusSignals {
  currentCommand: string;
  output: string;
  observation: PaneObservation;
  transcriptSnapshot: ClaudeStatusSnapshot | undefined;
  runtimeProcess: AgentRuntimeProcess | undefined;
  interactiveCommands: ReadonlySet<string>;
  runtimeFreshnessWindowMs: number | undefined;
}

export interface WorkerStatusEvaluation {
  status: Worker["status"];
  activityText: Worker["activityText"];
  activityTool: Worker["activityTool"];
  activityPath: Worker["activityPath"];
  confidence: number;
  reasons: StatusReason[];
  facts: StatusDecisionFacts;
}

interface CollectWorkerStatusSignalsInput {
  worker: Worker;
  tmux: TmuxAdapter;
  paneObservation: Map<string, PaneObservation>;
  claudeTranscript: ClaudeTranscriptTracker;
  interactiveCommands: ReadonlySet<string>;
  runtimeFreshnessWindowMs: number | undefined;
}

export async function collectWorkerStatusSignals({
  worker,
  tmux,
  paneObservation,
  claudeTranscript,
  interactiveCommands,
  runtimeFreshnessWindowMs
}: CollectWorkerStatusSignalsInput): Promise<WorkerStatusSignals | undefined> {
  const paneState = await tmux.getPaneState(worker.tmuxRef);
  if (paneState.isDead) {
    return undefined;
  }

  const currentCommandLower = paneState.currentCommand.toLowerCase();
  const runtimeProcess =
    paneState.panePid && (currentCommandLower === "bash" || currentCommandLower === "zsh" || currentCommandLower === "sh")
      ? await findAgentRuntimeProcess(paneState.panePid)
      : undefined;
  const captureCommand = runtimeProcess?.runtime ?? currentCommandLower;

  const [output, transcriptSnapshot] = await Promise.all([
    tmux.capturePane(worker.tmuxRef, capturePaneLineCount(worker, captureCommand)),
    claudeTranscript.poll(worker, paneState.currentCommand, paneState.currentPath, paneState.panePid)
  ]);
  const observation = observePane(paneObservation, worker.id, paneState.currentCommand, output);

  return {
    currentCommand: paneState.currentCommand,
    output,
    observation,
    transcriptSnapshot,
    runtimeProcess,
    interactiveCommands,
    runtimeFreshnessWindowMs
  };
}

export function evaluateWorkerStatusSignals(worker: Worker, signals: WorkerStatusSignals): WorkerStatusEvaluation {
  return evaluateWorkerStatus({
    worker,
    currentCommand: signals.currentCommand,
    output: signals.output,
    observation: signals.observation,
    transcriptSnapshot: signals.transcriptSnapshot,
    runtimeProcess: signals.runtimeProcess,
    interactiveCommands: signals.interactiveCommands,
    runtimeFreshnessWindowMs: signals.runtimeFreshnessWindowMs
  });
}

export function normalizeWorkerStatusEvaluation(evaluation: WorkerStatusEvaluation): WorkerStatusEvaluation {
  if (evaluation.status !== "idle") {
    return evaluation;
  }

  return {
    ...evaluation,
    activityText: undefined,
    activityTool: undefined,
    activityPath: undefined
  };
}
