import fs from "node:fs/promises";
import path from "node:path";
import type { Worker } from "../../../shared/types";
import {
  bootstrapTailBytes,
  claudeProjectRoot,
  maxRecentTranscriptAgeMs,
  transcriptFallbackCreatedAtSlackMs,
  transcriptFallbackFreshnessMs,
  transcriptLookupRetryMs
} from "./constants";
import { resetTranscriptState } from "./accumulator";
import type { ClaudeTranscriptState } from "./types";

interface ResolvedTranscriptPathInput {
  worker: Worker;
  state: ClaudeTranscriptState;
  paneCurrentPath: string | undefined;
  nowMs: number;
  /** Root under which Claude stores per-project transcripts. Defaults to
   * ~/.claude/projects; overridable so tests can resolve against a temp dir. */
  projectRoot?: string;
}

/**
 * How a transcript path was resolved. The tracker maps these to a match strength
 * for cross-worker exclusivity:
 *   - "existing"      re-confirmed this worker's still-present attachment (no contest)
 *   - "session-id"    exact file named by the pane's --session-id flag (strong)
 *   - "session-start" first record within the session-start window (strong)
 *   - "fallback"      bounded newest-mtime guess before start time is known (weak)
 */
export type TranscriptResolutionKind = "existing" | "session-id" | "session-start" | "fallback";

export interface ResolvedTranscript {
  path: string;
  kind: TranscriptResolutionKind;
}

export async function resolveTranscriptPath({
  worker,
  state,
  paneCurrentPath,
  nowMs,
  projectRoot = claudeProjectRoot
}: ResolvedTranscriptPathInput): Promise<ResolvedTranscript | undefined> {
  if (state.transcriptPath && (await isPathToFile(state.transcriptPath))) {
    state.nextTranscriptLookupAtMs = 0;
    return { path: state.transcriptPath, kind: "existing" };
  }

  if (nowMs < state.nextTranscriptLookupAtMs) {
    return undefined;
  }

  const candidateDirs = buildTranscriptCandidateDirs(projectRoot, worker.projectPath, paneCurrentPath);
  const sessionId = extractSessionId(worker.command);
  const workerCreatedAtMs = parseWorkerCreatedAtMs(worker.createdAt);

  for (const transcriptDir of candidateDirs) {
    if (!(await isPathToDirectory(transcriptDir))) {
      continue;
    }

    if (sessionId) {
      const directPath = path.join(transcriptDir, `${sessionId}.jsonl`);
      if (await isPathToFile(directPath)) {
        state.nextTranscriptLookupAtMs = 0;
        return { path: directPath, kind: "session-id" };
      }
    }

    const match = await findMatchingTranscriptFile(
      transcriptDir,
      nowMs,
      state.claudeSessionStartAtMs,
      workerCreatedAtMs
    );
    if (match) {
      state.nextTranscriptLookupAtMs = 0;
      return match;
    }
  }

  state.nextTranscriptLookupAtMs = nowMs + transcriptLookupRetryMs;
  return undefined;
}

function parseWorkerCreatedAtMs(createdAt: string): number | undefined {
  const parsed = Date.parse(createdAt);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function collectTranscriptInputLines(state: ClaudeTranscriptState): Promise<string[]> {
  const transcriptPath = state.transcriptPath;
  if (!transcriptPath) {
    return [];
  }

  const stats = await fs.stat(transcriptPath);
  if (!stats.isFile()) {
    return [];
  }

  if (!state.initialized || stats.size < state.fileOffset) {
    return bootstrapFromTail(state, transcriptPath, stats.size);
  }

  if (stats.size === state.fileOffset) {
    return [];
  }

  const chunk = await readFileRange(transcriptPath, state.fileOffset, stats.size - state.fileOffset);
  state.fileOffset = stats.size;
  return collectLinesFromChunk(state, chunk, false);
}

function buildTranscriptCandidateDirs(projectRoot: string, workerProjectPath: string, paneCurrentPath?: string): string[] {
  const candidates = [paneCurrentPath, workerProjectPath]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((projectPathValue) => path.join(projectRoot, projectPathValue.replace(/[^a-zA-Z0-9-]/g, "-")));

  const unique = new Set<string>();
  for (const candidate of candidates) {
    unique.add(candidate);
  }

  return [...unique];
}

const sessionMatchWindowMs = 10_000;

interface TranscriptCandidate {
  fullPath: string;
  mtimeMs: number;
  firstRecordTimestampMs: number | undefined;
}

async function findMatchingTranscriptFile(
  directoryPath: string,
  nowMs: number,
  claudeSessionStartAtMs: number | undefined,
  workerCreatedAtMs: number | undefined
): Promise<ResolvedTranscript | undefined> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const jsonlEntries = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"));

  if (jsonlEntries.length === 0) {
    return undefined;
  }

  const candidates = (
    await Promise.all(
      jsonlEntries.map(async (entry) => {
        const fullPath = path.join(directoryPath, entry.name);
        const stats = await fs.stat(fullPath);
        if (nowMs - stats.mtimeMs > maxRecentTranscriptAgeMs) {
          return undefined;
        }

        return { fullPath, mtimeMs: stats.mtimeMs, firstRecordTimestampMs: undefined as number | undefined };
      })
    )
  ).filter((c): c is TranscriptCandidate => c !== undefined);

  if (candidates.length === 0) {
    return undefined;
  }

  // Both branches now need the first-record timestamp: the session-start match
  // uses it directly, and the bounded fallback uses it to reject transcripts that
  // cannot belong to this worker.
  await Promise.all(
    candidates.map(async (candidate) => {
      candidate.firstRecordTimestampMs = await readFirstRecordTimestamp(candidate.fullPath);
    })
  );

  if (claudeSessionStartAtMs !== undefined) {
    // Known session start: only a first-record timestamp inside the match window
    // may attach. If none matches we deliberately do NOT fall back to newest-mtime
    // — attaching another session's transcript is strictly worse than attaching
    // none (the pane keeps its heuristic status and we retry later).
    const matched = findClosestByStartTime(candidates, claudeSessionStartAtMs);
    return matched ? { path: matched, kind: "session-start" } : undefined;
  }

  // Unknown session start: bounded mtime fallback only. This bridges the gap
  // between a fresh spawn and the pgrep/ps start-time lookup resolving.
  const fallback = selectBoundedFallback(candidates, nowMs, workerCreatedAtMs);
  return fallback ? { path: fallback, kind: "fallback" } : undefined;
}

/**
 * Pick the newest-mtime candidate that could plausibly belong to a worker whose
 * session start time is not yet known, or undefined if none qualifies.
 *
 * A candidate qualifies only when its first record is BOTH:
 *   (a) no earlier than `worker.createdAt` minus a small slack — a Claude session
 *       cannot meaningfully predate the worker process that hosts it; and
 *   (b) recent relative to now.
 *
 * Adoption case: when Arcane adopts an already-running pane, `worker.createdAt`
 * marks the adoption, not the real session start, so the session's genuine
 * transcript can predate createdAt and (a) alone would be unreliable. Bound (b)
 * closes that gap: it also rejects a stale foreign transcript that is hot (recent
 * mtime) but whose first record is old, which is exactly the shared-directory bug
 * this fallback previously caused. An adopted worker therefore attaches nothing
 * here and waits for the session-start match to claim its real transcript.
 *
 * A candidate with an unreadable first-record timestamp cannot be validated and
 * is rejected — never attach a transcript we cannot vouch for.
 */
function selectBoundedFallback(
  candidates: TranscriptCandidate[],
  nowMs: number,
  workerCreatedAtMs: number | undefined
): string | undefined {
  const freshnessLowerBoundMs = nowMs - transcriptFallbackFreshnessMs;
  const createdAtLowerBoundMs =
    workerCreatedAtMs !== undefined ? workerCreatedAtMs - transcriptFallbackCreatedAtSlackMs : undefined;

  const eligible = candidates.filter((candidate) => {
    const firstRecordMs = candidate.firstRecordTimestampMs;
    if (firstRecordMs === undefined) {
      return false;
    }
    if (firstRecordMs < freshnessLowerBoundMs) {
      return false;
    }
    if (createdAtLowerBoundMs !== undefined && firstRecordMs < createdAtLowerBoundMs) {
      return false;
    }
    return true;
  });

  if (eligible.length === 0) {
    return undefined;
  }

  eligible.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return eligible[0]?.fullPath;
}

function findClosestByStartTime(candidates: TranscriptCandidate[], targetMs: number): string | undefined {
  let bestPath: string | undefined;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    if (candidate.firstRecordTimestampMs === undefined) {
      continue;
    }

    const distance = Math.abs(candidate.firstRecordTimestampMs - targetMs);
    if (distance <= sessionMatchWindowMs && distance < bestDistance) {
      bestDistance = distance;
      bestPath = candidate.fullPath;
    }
  }

  return bestPath;
}

async function readFirstRecordTimestamp(filePath: string): Promise<number | undefined> {
  try {
    const chunk = await readFileRange(filePath, 0, 4096);
    const newlineIndex = chunk.indexOf("\n");
    const firstLine = newlineIndex >= 0 ? chunk.slice(0, newlineIndex) : chunk;
    if (!firstLine.trim()) {
      return undefined;
    }

    const record = JSON.parse(firstLine) as Record<string, unknown>;
    const timestamp = record.timestamp;
    if (typeof timestamp === "string") {
      const parsed = Date.parse(timestamp);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function readFileRange(filePath: string, startOffset: number, length: number): Promise<string> {
  if (length <= 0) {
    return "";
  }

  const fileHandle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    await fileHandle.read(buffer, 0, length, startOffset);
    return buffer.toString("utf8");
  } finally {
    await fileHandle.close();
  }
}

async function bootstrapFromTail(state: ClaudeTranscriptState, transcriptPath: string, fileSize: number): Promise<string[]> {
  const readLength = Math.min(fileSize, bootstrapTailBytes);
  const startOffset = fileSize - readLength;
  const chunk = await readFileRange(transcriptPath, startOffset, readLength);

  resetTranscriptState(state);
  state.fileOffset = fileSize;
  state.initialized = true;

  return collectLinesFromChunk(state, chunk, startOffset > 0);
}

function collectLinesFromChunk(state: ClaudeTranscriptState, chunk: string, dropFirstLine: boolean): string[] {
  const combined = state.lineBuffer + chunk;
  const lines = combined.split("\n");
  state.lineBuffer = lines.pop() ?? "";

  if (dropFirstLine && lines.length > 0) {
    lines.shift();
  }

  return lines;
}

async function isPathToFile(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

async function isPathToDirectory(directoryPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(directoryPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

function extractSessionId(command: string[]): string | undefined {
  for (let index = 0; index < command.length; index += 1) {
    const token = command[index];
    if (token === "--session-id") {
      const nextToken = command[index + 1];
      return typeof nextToken === "string" && nextToken.trim().length > 0 ? nextToken : undefined;
    }

    if (token.startsWith("--session-id=")) {
      const value = token.slice("--session-id=".length).trim();
      return value.length > 0 ? value : undefined;
    }
  }

  return undefined;
}
