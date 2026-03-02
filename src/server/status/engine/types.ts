import type { Worker } from "../../../shared/types";
import type { ParsedActivity } from "../activityParser";
import type { ClaudeStatusSnapshot } from "../claudeTranscriptTracker";
import type { PaneObservation } from "../paneObservation";

export interface StatusReason {
  code: string;
  message: string;
  detail?: string;
}

export interface StatusDecisionFacts {
  command: string;
  commandQuietForMs: number;
  outputQuietForMs: number;
  workerAgeMs: number;
  isClaudeSession: boolean;
  isOpenCodeSession: boolean;
  hasOpenCodePromptSignal: boolean;
  hasOpenCodeActiveSignal: boolean;
  hasClaudeProgressSignal: boolean;
  hasActiveClaudeTask: boolean;
  hasRuntimeActivityText: boolean;
  hasParsedStrongSignal: boolean;
  hasParsedNeedsInput: boolean;
  hasParsedError: boolean;
}

export interface WorkerStatusSignalContext {
  worker: Worker;
  nowMs: number;
  currentCommand: string;
  commandLower: string;
  output: string;
  observation: PaneObservation;
  transcriptSnapshot: ClaudeStatusSnapshot | undefined;
  parsed: {
    status: Worker["status"];
    activity: ParsedActivity;
  };
  runtimeActivityText: string | undefined;
  activeClaudeTask: string | undefined;
  hasClaudeProgressSignal: boolean;
  hasOpenCodePromptSignal: boolean;
  hasOpenCodeActiveSignal: boolean;
  isClaudeSession: boolean;
  isOpenCodeSession: boolean;
  outputQuietForMs: number;
  commandQuietForMs: number;
  workerAgeMs: number;
}

export interface WorkerStatusDecision {
  status: Worker["status"];
  activityText: Worker["activityText"];
  activityTool: Worker["activityTool"];
  activityPath: Worker["activityPath"];
  confidence: number;
  reasons: StatusReason[];
  facts: StatusDecisionFacts;
}
