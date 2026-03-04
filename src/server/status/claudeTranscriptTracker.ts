import type { Worker } from "../../shared/types";
import {
  applyParsedTranscriptRecords,
  createTranscriptState,
  resetTranscriptState
} from "./claudeTranscript/accumulator";
import { collectTranscriptInputLines, resolveTranscriptPath } from "./claudeTranscript/io";
import { extractTranscriptRecords } from "./claudeTranscript/parser";
import { buildSnapshot } from "./claudeTranscript/snapshot";
import type { ClaudeStatusSnapshot, ClaudeTranscriptState } from "./claudeTranscript/types";
import { isLikelyClaudeSession } from "./runtime/sessionDetection";

export type { ClaudeStatusSnapshot } from "./claudeTranscript/types";

export class ClaudeTranscriptTracker {
  private readonly states = new Map<string, ClaudeTranscriptState>();

  async poll(worker: Worker, paneCurrentCommand: string, paneCurrentPath?: string): Promise<ClaudeStatusSnapshot | undefined> {
    if (!isLikelyClaudeSession(worker, paneCurrentCommand.toLowerCase())) {
      this.states.delete(worker.id);
      return undefined;
    }

    const state = this.getState(worker.id);

    let transcriptPath: string | undefined;
    try {
      transcriptPath = await resolveTranscriptPath({
        worker,
        state,
        paneCurrentPath,
        nowMs: Date.now()
      });
    } catch {
      return undefined;
    }

    if (!transcriptPath) {
      return undefined;
    }

    if (state.transcriptPath !== transcriptPath) {
      state.transcriptPath = transcriptPath;
      resetTranscriptState(state);
    }

    try {
      const lines = await collectTranscriptInputLines(state);
      const records = extractTranscriptRecords(lines);
      applyParsedTranscriptRecords(state, records);
    } catch {
      return undefined;
    }

    return buildSnapshot(state, Date.now());
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
