import fs from "node:fs/promises";
import path from "node:path";
import type { Worker } from "../../../shared/types";
import {
  bootstrapTailBytes,
  claudeProjectRoot,
  maxRecentTranscriptAgeMs,
  transcriptLookupRetryMs
} from "./constants";
import { resetTranscriptState } from "./accumulator";
import type { ClaudeTranscriptState } from "./types";

interface ResolvedTranscriptPathInput {
  worker: Worker;
  state: ClaudeTranscriptState;
  paneCurrentPath: string | undefined;
  nowMs: number;
}

export async function resolveTranscriptPath({
  worker,
  state,
  paneCurrentPath,
  nowMs
}: ResolvedTranscriptPathInput): Promise<string | undefined> {
  if (state.transcriptPath && (await isPathToFile(state.transcriptPath))) {
    state.nextTranscriptLookupAtMs = 0;
    return state.transcriptPath;
  }

  if (nowMs < state.nextTranscriptLookupAtMs) {
    return undefined;
  }

  const candidateDirs = buildTranscriptCandidateDirs(worker.projectPath, paneCurrentPath);
  const sessionId = extractSessionId(worker.command);

  for (const transcriptDir of candidateDirs) {
    if (!(await isPathToDirectory(transcriptDir))) {
      continue;
    }

    if (sessionId) {
      const directPath = path.join(transcriptDir, `${sessionId}.jsonl`);
      if (await isPathToFile(directPath)) {
        state.nextTranscriptLookupAtMs = 0;
        return directPath;
      }
    }

    const latest = await findLatestTranscriptFile(transcriptDir, nowMs);
    if (latest) {
      state.nextTranscriptLookupAtMs = 0;
      return latest;
    }
  }

  state.nextTranscriptLookupAtMs = nowMs + transcriptLookupRetryMs;
  return undefined;
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

function buildTranscriptCandidateDirs(workerProjectPath: string, paneCurrentPath?: string): string[] {
  const candidates = [paneCurrentPath, workerProjectPath]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((projectPathValue) => path.join(claudeProjectRoot, projectPathValue.replace(/[^a-zA-Z0-9-]/g, "-")));

  const unique = new Set<string>();
  for (const candidate of candidates) {
    unique.add(candidate);
  }

  return [...unique];
}

async function findLatestTranscriptFile(directoryPath: string, nowMs: number): Promise<string | undefined> {
  let latestPath: string | undefined;
  let latestMtimeMs = 0;

  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }

    const fullPath = path.join(directoryPath, entry.name);
    const stats = await fs.stat(fullPath);
    if (!stats.isFile()) {
      continue;
    }

    if (stats.mtimeMs > latestMtimeMs) {
      latestMtimeMs = stats.mtimeMs;
      latestPath = fullPath;
    }
  }

  if (!latestPath) {
    return undefined;
  }

  if (nowMs - latestMtimeMs > maxRecentTranscriptAgeMs) {
    return undefined;
  }

  return latestPath;
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
