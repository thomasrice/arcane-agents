import type { Worker } from "../../shared/types";
import {
  applyParsedTranscriptRecords,
  createTranscriptState,
  resetTranscriptState
} from "./claudeTranscript/accumulator";
import { claudeProjectRoot } from "./claudeTranscript/constants";
import { collectTranscriptInputLines, resolveTranscriptPath } from "./claudeTranscript/io";
import { extractTranscriptRecords } from "./claudeTranscript/parser";
import { findClaudeSessionStartTimeMs } from "./claudeTranscript/process";
import { buildSnapshot } from "./claudeTranscript/snapshot";
import type { ClaudeStatusSnapshot, ClaudeTranscriptState, TranscriptHealth } from "./claudeTranscript/types";
import { isLikelyClaudeSession } from "./runtimes/claude";

export type { ClaudeStatusSnapshot, TranscriptHealth } from "./claudeTranscript/types";

/** Result of one poll: the derived snapshot (if any) plus transcript health. */
export interface ClaudeTranscriptPollResult {
  snapshot: ClaudeStatusSnapshot | undefined;
  health: TranscriptHealth;
}

/**
 * A failed pgrep/ps session-start lookup used to be stored as the falsy sentinel
 * `0`, which the `=== undefined` retry guard then treated as "already looked up" —
 * so a transient pgrep failure was never retried for the worker's whole life.
 * We now retry after this cooldown.
 */
export const failedSessionLookupRetryMs = 15_000;

export interface ClaudeTranscriptTrackerOptions {
  /** Root directory Claude stores transcripts under (default ~/.claude/projects).
   * Overridable so tests can resolve transcripts against a temp directory. */
  projectRoot?: string;
}

export class ClaudeTranscriptTracker {
  private readonly states = new Map<string, ClaudeTranscriptState>();
  private readonly projectRoot: string;

  constructor(options: ClaudeTranscriptTrackerOptions = {}) {
    this.projectRoot = options.projectRoot ?? claudeProjectRoot;
  }

  async poll(
    worker: Worker,
    paneCurrentCommand: string,
    paneCurrentPath?: string,
    panePid?: number
  ): Promise<ClaudeTranscriptPollResult> {
    if (!isLikelyClaudeSession(worker, paneCurrentCommand.toLowerCase())) {
      this.states.delete(worker.id);
      return { snapshot: undefined, health: "absent" };
    }

    const state = this.getState(worker.id);

    if (panePid) {
      await this.resolveSessionStart(state, panePid);
    }

    let transcriptPath: string | undefined;
    try {
      transcriptPath = await resolveTranscriptPath({
        worker,
        state,
        paneCurrentPath,
        nowMs: Date.now(),
        projectRoot: this.projectRoot
      });
    } catch {
      return { snapshot: undefined, health: "error" };
    }

    if (!transcriptPath) {
      return { snapshot: undefined, health: "absent" };
    }

    if (state.transcriptPath !== transcriptPath) {
      state.transcriptPath = transcriptPath;
      resetTranscriptState(state);
    }

    try {
      const wasInitialized = state.initialized;
      const lines = await collectTranscriptInputLines(state);
      const records = extractTranscriptRecords(lines);
      applyParsedTranscriptRecords(state, records, Date.now());
      if (!wasInitialized && state.initialized) {
        state.busyUntilMs = 0;
      }
    } catch {
      return { snapshot: undefined, health: "error" };
    }

    return { snapshot: buildSnapshot(state, Date.now()), health: "ok" };
  }

  /**
   * Resolve the Claude process start time once. On success it is cached forever;
   * on failure the lookup is retried after `failedSessionLookupRetryMs` rather
   * than being abandoned for the worker's lifetime.
   */
  private async resolveSessionStart(state: ClaudeTranscriptState, panePid: number): Promise<void> {
    const lookup = state.sessionStartLookup;
    const nowMs = Date.now();
    const canLookup = lookup.status === "pending" || (lookup.status === "failed" && nowMs >= lookup.nextRetryAtMs);
    if (!canLookup) {
      return;
    }

    const startTime = await findClaudeSessionStartTimeMs(panePid).catch(() => undefined);
    if (startTime !== undefined) {
      state.claudeSessionStartAtMs = startTime;
      state.sessionStartLookup = { status: "resolved", nextRetryAtMs: 0 };
    } else {
      state.sessionStartLookup = { status: "failed", nextRetryAtMs: nowMs + failedSessionLookupRetryMs };
    }
  }

  forget(workerId: string): void {
    this.states.delete(workerId);
  }

  private getState(workerId: string): ClaudeTranscriptState {
    const existing = this.states.get(workerId);
    if (existing) {
      return existing;
    }

    const next = createTranscriptState();
    this.states.set(workerId, next);
    return next;
  }
}
