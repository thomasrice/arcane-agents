import type { ActivityTool, WorkerStatus } from "../../../shared/types";

export interface ActiveToolEntry {
  toolName: string;
  statusText: string;
  activityTool?: ActivityTool;
  activityPath?: string;
  lastProgressAtMs: number;
}

/**
 * Health of the transcript channel for a Claude worker, surfaced as a decision
 * fact so /api debug output can tell "transcript healthy but idle" apart from
 * "transcript broken":
 *   - "ok"     the transcript file resolved and was read/parsed cleanly
 *   - "absent" no transcript applies (non-Claude worker) or none was found yet
 *   - "error"  resolution / IO / parse failed (worker falls back to pane heuristics)
 */
export type TranscriptHealth = "ok" | "absent" | "error";

/**
 * Explicit lifecycle for the (side-effecting) pgrep/ps session-start lookup,
 * replacing the old falsy `0` sentinel. A failed lookup is retried after a
 * cooldown instead of never, and a resolved lookup is never repeated.
 */
export interface SessionStartLookupState {
  status: "pending" | "resolved" | "failed";
  /** Earliest wall-clock ms at which a failed lookup may be retried. */
  nextRetryAtMs: number;
}

export interface ClaudeTranscriptState {
  transcriptPath?: string;
  claudeSessionStartAtMs?: number;
  sessionStartLookup: SessionStartLookupState;
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
