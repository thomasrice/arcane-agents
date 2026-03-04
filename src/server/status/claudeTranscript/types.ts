import type { ActivityTool, WorkerStatus } from "../../../shared/types";

export interface ActiveToolEntry {
  toolName: string;
  statusText: string;
  activityTool?: ActivityTool;
  activityPath?: string;
  lastProgressAtMs: number;
}

export interface ClaudeTranscriptState {
  transcriptPath?: string;
  nextTranscriptLookupAtMs: number;
  fileOffset: number;
  lineBuffer: string;
  initialized: boolean;
  seenTranscriptRecord: boolean;
  activeTools: Map<string, ActiveToolEntry>;
  activeSubagentTools: Map<string, Map<string, ActiveToolEntry>>;
  waiting: boolean;
  lastEventAtMs: number;
  busyUntilMs: number;
  lastActivityText?: string;
  lastActivityTool?: ActivityTool;
  lastActivityPath?: string;
}

export interface ClaudeStatusSnapshot {
  status: WorkerStatus;
  activityText?: string;
  activityTool?: ActivityTool;
  activityPath?: string;
}

export interface ParsedTranscriptRecord {
  type: "assistant" | "user" | "system" | "progress";
  record: Record<string, unknown>;
}
