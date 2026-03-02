import type { Worker } from "../../shared/types";
import { TmuxAdapter } from "../tmux/tmuxAdapter";
import { capturePaneLineCount } from "./runtimeSignals";
import { evaluateWorkerStatus } from "./statusEvaluator";
import { observePane, type PaneObservation } from "./paneObservation";
import { ClaudeTranscriptTracker } from "./claudeTranscriptTracker";
import type { StatusDecisionFacts, StatusReason } from "./engine/types";

export interface WorkerStatusSignals {
  currentCommand: string;
  output: string;
  observation: PaneObservation;
  transcriptSnapshot: ReturnType<ClaudeTranscriptTracker["poll"]>;
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
}

export async function collectWorkerStatusSignals({
  worker,
  tmux,
  paneObservation,
  claudeTranscript
}: CollectWorkerStatusSignalsInput): Promise<WorkerStatusSignals | undefined> {
  const paneState = await tmux.getPaneState(worker.tmuxRef);
  if (paneState.isDead) {
    return undefined;
  }

  const output = await tmux.capturePane(worker.tmuxRef, capturePaneLineCount(worker, paneState.currentCommand.toLowerCase()));
  const transcriptSnapshot = claudeTranscript.poll(worker, paneState.currentCommand, paneState.currentPath);
  const observation = observePane(paneObservation, worker.id, paneState.currentCommand, output);

  return {
    currentCommand: paneState.currentCommand,
    output,
    observation,
    transcriptSnapshot
  };
}

export function evaluateWorkerStatusSignals(worker: Worker, signals: WorkerStatusSignals): WorkerStatusEvaluation {
  return evaluateWorkerStatus({
    worker,
    currentCommand: signals.currentCommand,
    output: signals.output,
    observation: signals.observation,
    transcriptSnapshot: signals.transcriptSnapshot
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
