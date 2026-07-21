import type { Worker } from "../../shared/types";
import {
  applyParsedTranscriptRecords,
  createTranscriptState,
  resetTranscriptState
} from "./claudeTranscript/accumulator";
import { transcriptLookupRetryMs } from "./claudeTranscript/constants";
import {
  collectTranscriptInputLines,
  resolveClaudeProjectRootForProcess,
  resolveTranscriptPath,
  type ResolvedTranscript
} from "./claudeTranscript/io";
import { extractTranscriptRecords } from "./claudeTranscript/parser";
import { findClaudeSessionStartTimeMs } from "./claudeTranscript/process";
import { buildSnapshot } from "./claudeTranscript/snapshot";
import type {
  ClaudeStatusSnapshot,
  ClaudeTranscriptState,
  TranscriptHealth,
  TranscriptMatchStrength
} from "./claudeTranscript/types";
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
  /** Resolve a worker's transcript root from its live Claude process environment. */
  resolveProjectRoot?: (pid: number | undefined) => Promise<string>;
}

/** Per-poll pane context the caller (collectSignals) threads in. */
export interface ClaudeTranscriptPollContext {
  /** True when the pane produced fresh output since the previous poll. Drives the
   * activity-correlation attach for long-lived panes whose start time no longer
   * matches any candidate transcript. */
  paneOutputChanged: boolean;
}

export class ClaudeTranscriptTracker {
  private readonly states = new Map<string, ClaudeTranscriptState>();
  private readonly projectRootOverride: string | undefined;
  private readonly resolveProjectRoot: (pid: number | undefined) => Promise<string>;
  private readonly projectRootsByWorker = new Map<string, { pid: number | undefined; path: string }>();

  constructor(options: ClaudeTranscriptTrackerOptions = {}) {
    this.projectRootOverride = options.projectRoot;
    this.resolveProjectRoot = options.resolveProjectRoot ?? resolveClaudeProjectRootForProcess;
  }

  async poll(
    worker: Worker,
    paneCurrentCommand: string,
    paneCurrentPath?: string,
    panePid?: number,
    paneContext?: ClaudeTranscriptPollContext
  ): Promise<ClaudeTranscriptPollResult> {
    if (!isLikelyClaudeSession(worker, paneCurrentCommand.toLowerCase())) {
      this.states.delete(worker.id);
      this.projectRootsByWorker.delete(worker.id);
      return { snapshot: undefined, health: "absent" };
    }

    const state = this.getState(worker.id);

    if (panePid) {
      await this.resolveSessionStart(state, panePid);
    }

    const nowMs = Date.now();
    let resolved: ResolvedTranscript | undefined;
    try {
      const projectRoot = await this.projectRootFor(worker.id, panePid, state);
      resolved = await resolveTranscriptPath({
        worker,
        state,
        paneCurrentPath,
        nowMs,
        projectRoot,
        paneOutputChanged: paneContext?.paneOutputChanged ?? false,
        isPathClaimedByOtherWorker: (transcriptPath) =>
          this.findTranscriptHolder(transcriptPath, worker.id) !== undefined
      });
    } catch {
      return { snapshot: undefined, health: "error" };
    }

    if (!resolved) {
      // No transcript resolves (none found, the file vanished, or we are waiting
      // to retry). Drop any stale attachment so a gone file can't linger as a
      // phantom exclusivity holder, and report absent so health reflects "no
      // transcript" rather than "ok".
      this.releaseTranscript(state);
      return { snapshot: undefined, health: "absent" };
    }

    if (!this.claimTranscript(worker.id, state, resolved, nowMs)) {
      // Another worker owns this transcript and outranks this attachment. Keep
      // pane heuristics (absent) and retry later rather than binding one file to
      // two workers.
      return { snapshot: undefined, health: "absent" };
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

  /**
   * Bind a resolved transcript to this worker, enforcing that one transcript file
   * belongs to at most one worker. Returns false when this worker must NOT attach
   * the file (its caller then reports absent and retries).
   *
   * Contest rule: a strong attachment (explicit --session-id, or a first-record
   * timestamp inside the session-start window) beats a weak one (the bounded mtime
   * fallback, or an activity-correlation match). A strong challenger evicts a weak
   * incumbent; otherwise the incumbent keeps the file and the challenger loses.
   */
  private claimTranscript(
    workerId: string,
    state: ClaudeTranscriptState,
    resolved: ResolvedTranscript,
    nowMs: number
  ): boolean {
    // "existing" only ever re-confirms this worker's own still-present file, so
    // there is nothing to contest and its strength is already recorded.
    if (resolved.kind === "existing") {
      return true;
    }

    const strength: TranscriptMatchStrength =
      resolved.kind === "fallback" || resolved.kind === "correlation" ? "weak" : "strong";
    const incumbent = this.findTranscriptHolder(resolved.path, workerId);

    if (incumbent) {
      const incumbentStrength = incumbent.transcriptMatchStrength ?? "weak";
      const challengerWins = strength === "strong" && incumbentStrength === "weak";
      if (!challengerWins) {
        state.nextTranscriptLookupAtMs = nowMs + transcriptLookupRetryMs;
        return false;
      }

      this.detachTranscript(incumbent, nowMs);
    }

    if (state.transcriptPath !== resolved.path) {
      resetTranscriptState(state);
    }
    state.transcriptPath = resolved.path;
    state.transcriptMatchStrength = strength;
    return true;
  }

  /** The other worker's state currently holding `transcriptPath`, if any. */
  private findTranscriptHolder(transcriptPath: string, exceptWorkerId: string): ClaudeTranscriptState | undefined {
    for (const [id, candidate] of this.states) {
      if (id !== exceptWorkerId && candidate.transcriptPath === transcriptPath) {
        return candidate;
      }
    }

    return undefined;
  }

  /**
   * Detach a transcript that was lost to exclusivity so the worker falls back to
   * pane heuristics (health absent on its next poll) and re-resolves after the
   * retry cooldown.
   */
  private detachTranscript(state: ClaudeTranscriptState, nowMs: number): void {
    resetTranscriptState(state);
    state.transcriptPath = undefined;
    state.transcriptMatchStrength = undefined;
    state.nextTranscriptLookupAtMs = nowMs + transcriptLookupRetryMs;
  }

  /** Drop a now-invalid attachment (gone file / no resolution) without rescheduling. */
  private releaseTranscript(state: ClaudeTranscriptState): void {
    if (!state.transcriptPath) {
      return;
    }

    resetTranscriptState(state);
    state.transcriptPath = undefined;
    state.transcriptMatchStrength = undefined;
  }

  private async projectRootFor(
    workerId: string,
    pid: number | undefined,
    state: ClaudeTranscriptState
  ): Promise<string> {
    if (this.projectRootOverride) {
      return this.projectRootOverride;
    }

    const cached = this.projectRootsByWorker.get(workerId);
    if (cached && cached.pid === pid) {
      return cached.path;
    }

    const projectRoot = await this.resolveProjectRoot(pid);
    if (cached && cached.path !== projectRoot) {
      this.releaseTranscript(state);
    }
    this.projectRootsByWorker.set(workerId, { pid, path: projectRoot });
    return projectRoot;
  }

  forget(workerId: string): void {
    this.states.delete(workerId);
    this.projectRootsByWorker.delete(workerId);
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
