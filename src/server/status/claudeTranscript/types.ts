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

/**
 * How the currently-attached transcript was resolved, used by the tracker to
 * enforce cross-worker exclusivity. A "strong" attachment comes from a positive
 * identity match (explicit --session-id file, or a first-record timestamp within
 * the session-start window); a "weak" attachment is the bounded mtime fallback.
 * When two workers contest the same file, a strong attachment evicts a weak one.
 */
export type TranscriptMatchStrength = "strong" | "weak";

/**
 * Evidence that one candidate transcript is moving in lockstep with this worker's
 * pane, accumulated across polls when start-time matching cannot resolve a file
 * (see io.ts `resolveByActivityCorrelation`). Kept deliberately tiny — a single
 * candidate path, a streak count, and the wall-clock ms of the last qualifying
 * (pane-changed) poll that advanced it.
 */
export interface TranscriptCorrelationState {
  /** Candidate currently accumulating a streak, or undefined when none. */
  candidatePath: string | undefined;
  /** Consecutive qualifying polls this candidate has correlated on. */
  streak: number;
  /** Wall-clock ms of the last qualifying poll that advanced the streak. */
  lastQualifyingPollMs: number;
}

export interface ClaudeTranscriptState {
  transcriptPath?: string;
  /** Strength of the current `transcriptPath` attachment; undefined when none. */
  transcriptMatchStrength?: TranscriptMatchStrength;
  /** Activity-correlation streak used only while unattached. */
  correlation: TranscriptCorrelationState;
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
