import type { Worker } from "../../shared/types";
import type { ClaudeStatusSnapshot } from "./claudeTranscriptTracker";
import type { PaneObservation } from "./paneObservation";
import type { AgentRuntimeProcess } from "./runtime/runtimeProcess";
import { buildWorkerStatusSignalContext } from "./engine/signalContext";
import { deriveWorkerStatusDecision } from "./engine/stateMachine";
import type { StatusDecisionFacts, StatusReason } from "./engine/types";

interface EvaluateWorkerStatusInput {
  worker: Worker;
  currentCommand: string;
  output: string;
  observation: PaneObservation;
  transcriptSnapshot: ClaudeStatusSnapshot | undefined;
  runtimeProcess: AgentRuntimeProcess | undefined;
  interactiveCommands: ReadonlySet<string>;
  runtimeFreshnessWindowMs: number | undefined;
}

export interface EvaluatedWorkerStatus {
  status: Worker["status"];
  activityText: string | undefined;
  activityTool: Worker["activityTool"];
  activityPath: string | undefined;
  confidence: number;
  reasons: StatusReason[];
  facts: StatusDecisionFacts;
}

export function evaluateWorkerStatus({
  worker,
  currentCommand,
  output,
  observation,
  transcriptSnapshot,
  runtimeProcess,
  interactiveCommands,
  runtimeFreshnessWindowMs
}: EvaluateWorkerStatusInput): EvaluatedWorkerStatus {
  const context = buildWorkerStatusSignalContext({
    worker,
    currentCommand,
    output,
    observation,
    transcriptSnapshot,
    runtimeProcess,
    nowMs: Date.now(),
    interactiveCommands,
    runtimeFreshnessWindowMs
  });

  return deriveWorkerStatusDecision(context);
}
