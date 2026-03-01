import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ActivityTool, Worker, WorkerStatus } from "../../shared/types";

const claudeProjectRoot = path.join(os.homedir(), ".claude", "projects");
const bootstrapTailBytes = 196_608;
const textIdleDelayMs = 5_000;
const permissionIdleDelayMs = 12_000;
const maxRecentTranscriptAgeMs = 3 * 24 * 60 * 60 * 1000;

const bashCommandDisplayMaxLength = 72;
const taskDescriptionDisplayMaxLength = 56;

const permissionExemptTools = new Set(["task", "askuserquestion"]);

interface ActiveToolEntry {
  toolName: string;
  statusText: string;
  activityTool?: ActivityTool;
  activityPath?: string;
  startedAtMs: number;
  lastProgressAtMs: number;
}

interface ClaudeTranscriptState {
  transcriptPath?: string;
  fileOffset: number;
  lineBuffer: string;
  initialized: boolean;
  seenTranscriptRecord: boolean;
  activeTools: Map<string, ActiveToolEntry>;
  activeSubagentTools: Map<string, Map<string, ActiveToolEntry>>;
  waiting: boolean;
  hadToolsInTurn: boolean;
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

export class ClaudeTranscriptTracker {
  private readonly states = new Map<string, ClaudeTranscriptState>();

  poll(worker: Worker, paneCurrentCommand: string, paneCurrentPath?: string): ClaudeStatusSnapshot | undefined {
    if (!isLikelyClaudeWorker(worker, paneCurrentCommand)) {
      this.states.delete(worker.id);
      return undefined;
    }

    const state = this.getState(worker.id);
    const transcriptPath = resolveTranscriptPath(worker, state, paneCurrentPath);
    if (!transcriptPath) {
      return undefined;
    }

    if (state.transcriptPath !== transcriptPath) {
      state.transcriptPath = transcriptPath;
      resetTranscriptState(state);
    }

    try {
      this.readTranscriptUpdates(state);
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

    const next: ClaudeTranscriptState = {
      fileOffset: 0,
      lineBuffer: "",
      initialized: false,
      seenTranscriptRecord: false,
      activeTools: new Map(),
      activeSubagentTools: new Map(),
      waiting: false,
      hadToolsInTurn: false,
      lastEventAtMs: 0,
      busyUntilMs: 0,
      lastActivityText: undefined,
      lastActivityTool: undefined,
      lastActivityPath: undefined
    };

    this.states.set(workerId, next);
    return next;
  }

  private readTranscriptUpdates(state: ClaudeTranscriptState): void {
    const transcriptPath = state.transcriptPath;
    if (!transcriptPath) {
      return;
    }

    const stats = fs.statSync(transcriptPath);
    if (!stats.isFile()) {
      return;
    }

    if (!state.initialized || stats.size < state.fileOffset) {
      this.bootstrapFromTail(state, stats.size);
      return;
    }

    if (stats.size === state.fileOffset) {
      return;
    }

    const chunk = readFileRange(transcriptPath, state.fileOffset, stats.size - state.fileOffset);
    state.fileOffset = stats.size;
    ingestChunk(state, chunk, false);
  }

  private bootstrapFromTail(state: ClaudeTranscriptState, fileSize: number): void {
    const transcriptPath = state.transcriptPath;
    if (!transcriptPath) {
      return;
    }

    const readLength = Math.min(fileSize, bootstrapTailBytes);
    const startOffset = fileSize - readLength;
    const chunk = readFileRange(transcriptPath, startOffset, readLength);

    resetTranscriptState(state);
    state.fileOffset = fileSize;
    state.initialized = true;

    ingestChunk(state, chunk, startOffset > 0);
  }
}

function buildSnapshot(state: ClaudeTranscriptState, nowMs: number): ClaudeStatusSnapshot | undefined {
  if (!state.seenTranscriptRecord) {
    return undefined;
  }

  const activeTools = listActiveTools(state);
  const mostRecentTool = activeTools.reduce<ActiveToolEntry | undefined>((latest, current) => {
    if (!latest) {
      return current;
    }

    if (current.lastProgressAtMs >= latest.lastProgressAtMs) {
      return current;
    }

    return latest;
  }, undefined);

  const hasAskUserQuestion = activeTools.some((entry) => normalizeToolName(entry.toolName) === "askuserquestion");
  const hasNonExemptActiveTools = activeTools.some((entry) => !permissionExemptTools.has(normalizeToolName(entry.toolName)));

  const isPermissionWait = hasNonExemptActiveTools && nowMs - state.lastEventAtMs >= permissionIdleDelayMs;
  const isActivelyWorking = activeTools.length > 0 || nowMs <= state.busyUntilMs;

  let status: WorkerStatus = "idle";
  if (hasAskUserQuestion || isPermissionWait) {
    status = "attention";
  } else if (isActivelyWorking && !state.waiting) {
    status = "working";
  } else {
    status = "idle";
  }

  let activityText = mostRecentTool?.statusText ?? state.lastActivityText;
  let activityTool = mostRecentTool?.activityTool ?? state.lastActivityTool;
  let activityPath = mostRecentTool?.activityPath ?? state.lastActivityPath;

  if (hasAskUserQuestion) {
    activityText = "Waiting for your answer";
    activityTool = "terminal";
  } else if (isPermissionWait) {
    activityText = activityText ?? "Waiting for approval";
    activityTool = activityTool ?? "terminal";
  }

  if (status === "idle" && activityText === "Waiting for approval") {
    activityText = undefined;
    activityTool = undefined;
    activityPath = undefined;
  }

  return {
    status,
    activityText,
    activityTool,
    activityPath
  };
}

function resolveTranscriptPath(worker: Worker, state: ClaudeTranscriptState, paneCurrentPath?: string): string | undefined {
  if (state.transcriptPath && fs.existsSync(state.transcriptPath)) {
    return state.transcriptPath;
  }

  const candidateDirs = buildTranscriptCandidateDirs(worker.projectPath, paneCurrentPath);
  const sessionId = extractSessionId(worker.command);

  for (const transcriptDir of candidateDirs) {
    if (!fs.existsSync(transcriptDir)) {
      continue;
    }

    if (sessionId) {
      const directPath = path.join(transcriptDir, `${sessionId}.jsonl`);
      if (fs.existsSync(directPath)) {
        return directPath;
      }
    }

    const latest = findLatestTranscriptFile(transcriptDir);
    if (latest) {
      return latest;
    }
  }

  return undefined;
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

function findLatestTranscriptFile(directoryPath: string): string | undefined {
  let latestPath: string | undefined;
  let latestMtimeMs = 0;

  const entries = fs.readdirSync(directoryPath);
  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) {
      continue;
    }

    const fullPath = path.join(directoryPath, entry);
    const stats = fs.statSync(fullPath);
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

  if (Date.now() - latestMtimeMs > maxRecentTranscriptAgeMs) {
    return undefined;
  }

  return latestPath;
}

function readFileRange(filePath: string, startOffset: number, length: number): string {
  if (length <= 0) {
    return "";
  }

  const buffer = Buffer.alloc(length);
  const descriptor = fs.openSync(filePath, "r");
  try {
    fs.readSync(descriptor, buffer, 0, length, startOffset);
  } finally {
    fs.closeSync(descriptor);
  }

  return buffer.toString("utf8");
}

function ingestChunk(state: ClaudeTranscriptState, chunk: string, dropFirstLine: boolean): void {
  const combined = state.lineBuffer + chunk;
  const lines = combined.split("\n");
  state.lineBuffer = lines.pop() ?? "";

  if (dropFirstLine && lines.length > 0) {
    lines.shift();
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    processTranscriptLine(state, trimmed);
  }
}

function processTranscriptLine(state: ClaudeTranscriptState, rawLine: string): void {
  const record = parseRecord(rawLine);
  if (!record) {
    return;
  }

  const recordType = readString(record.type);
  if (!recordType) {
    return;
  }

  const nowMs = Date.now();

  switch (recordType) {
    case "assistant": {
      processAssistantRecord(state, record, nowMs);
      break;
    }
    case "user": {
      processUserRecord(state, record, nowMs);
      break;
    }
    case "system": {
      processSystemRecord(state, record);
      break;
    }
    case "progress": {
      processProgressRecord(state, record, nowMs);
      break;
    }
    default: {
      return;
    }
  }

  state.seenTranscriptRecord = true;
  state.lastEventAtMs = nowMs;
}

function processAssistantRecord(state: ClaudeTranscriptState, record: Record<string, unknown>, nowMs: number): void {
  const message = readRecord(record.message);
  const content = readArray(message?.content);
  if (!content) {
    return;
  }

  let hasToolUse = false;
  let hasText = false;

  for (const block of content) {
    const parsedBlock = readRecord(block);
    if (!parsedBlock) {
      continue;
    }

    const blockType = readString(parsedBlock.type);
    if (blockType === "tool_use") {
      const toolId = readString(parsedBlock.id);
      if (!toolId) {
        continue;
      }

      const toolName = readString(parsedBlock.name) ?? "Tool";
      const input = readRecord(parsedBlock.input) ?? {};
      const entry = createActiveToolEntry(toolName, input, nowMs);

      state.activeTools.set(toolId, entry);
      setLastActivity(state, entry.statusText, entry.activityTool, entry.activityPath);
      hasToolUse = true;
      continue;
    }

    if (blockType === "text") {
      hasText = true;
    }
  }

  if (hasToolUse) {
    state.waiting = false;
    state.hadToolsInTurn = true;
    state.busyUntilMs = nowMs + textIdleDelayMs;
    return;
  }

  if (hasText) {
    state.waiting = false;
    state.busyUntilMs = nowMs + textIdleDelayMs;
    if (!state.lastActivityText) {
      setLastActivity(state, "Responding", "terminal", undefined);
    }
  }
}

function processUserRecord(state: ClaudeTranscriptState, record: Record<string, unknown>, nowMs: number): void {
  const message = readRecord(record.message);
  const content = message?.content;

  if (Array.isArray(content)) {
    let hasToolResult = false;
    for (const block of content) {
      const parsedBlock = readRecord(block);
      if (!parsedBlock || readString(parsedBlock.type) !== "tool_result") {
        continue;
      }

      const completedToolId = readString(parsedBlock.tool_use_id);
      if (!completedToolId) {
        continue;
      }

      const completedToolName = state.activeTools.get(completedToolId)?.toolName;
      if (normalizeToolName(completedToolName ?? "") === "task") {
        state.activeSubagentTools.delete(completedToolId);
      }

      state.activeTools.delete(completedToolId);
      hasToolResult = true;
    }

    if (hasToolResult) {
      state.waiting = false;
      state.busyUntilMs = nowMs + textIdleDelayMs;
      if (state.activeTools.size === 0) {
        state.hadToolsInTurn = false;
      }
      return;
    }

    const hasPromptText = content.some((block) => {
      if (typeof block === "string") {
        return block.trim().length > 0;
      }

      const parsedBlock = readRecord(block);
      if (!parsedBlock) {
        return false;
      }

      if (readString(parsedBlock.type) !== "text") {
        return false;
      }

      const text = readString(parsedBlock.text);
      return Boolean(text && text.trim().length > 0);
    });

    if (hasPromptText) {
      clearActiveTools(state);
      state.waiting = false;
      state.hadToolsInTurn = false;
      state.busyUntilMs = nowMs + textIdleDelayMs;
      setLastActivity(state, "Responding", "terminal", undefined);
    }

    return;
  }

  if (typeof content === "string" && content.trim().length > 0) {
    clearActiveTools(state);
    state.waiting = false;
    state.hadToolsInTurn = false;
    state.busyUntilMs = nowMs + textIdleDelayMs;
    setLastActivity(state, "Responding", "terminal", undefined);
  }
}

function processSystemRecord(state: ClaudeTranscriptState, record: Record<string, unknown>): void {
  if (readString(record.subtype) !== "turn_duration") {
    return;
  }

  clearActiveTools(state);
  state.waiting = true;
  state.hadToolsInTurn = false;
  state.busyUntilMs = 0;
  state.lastActivityText = undefined;
  state.lastActivityTool = undefined;
  state.lastActivityPath = undefined;
}

function processProgressRecord(state: ClaudeTranscriptState, record: Record<string, unknown>, nowMs: number): void {
  const parentToolId = readString(record.parentToolUseID) ?? readString(record.parent_tool_use_id);
  if (!parentToolId) {
    return;
  }

  const data = readRecord(record.data);
  if (!data) {
    return;
  }

  const progressType = readString(data.type);
  if ((progressType === "bash_progress" || progressType === "mcp_progress") && state.activeTools.has(parentToolId)) {
    touchTool(state.activeTools.get(parentToolId), nowMs);
    state.waiting = false;
    state.busyUntilMs = nowMs + textIdleDelayMs;
    return;
  }

  const parentTool = state.activeTools.get(parentToolId);
  if (!parentTool || normalizeToolName(parentTool.toolName) !== "task") {
    return;
  }

  const progressMessage = readRecord(data.message);
  const messageType = readString(progressMessage?.type);
  const innerMessage = readRecord(progressMessage?.message);
  const content = readArray(innerMessage?.content);
  if (!messageType || !content) {
    return;
  }

  if (messageType === "assistant") {
    let subagentTools = state.activeSubagentTools.get(parentToolId);
    if (!subagentTools) {
      subagentTools = new Map<string, ActiveToolEntry>();
      state.activeSubagentTools.set(parentToolId, subagentTools);
    }

    for (const block of content) {
      const parsedBlock = readRecord(block);
      if (!parsedBlock || readString(parsedBlock.type) !== "tool_use") {
        continue;
      }

      const toolId = readString(parsedBlock.id);
      if (!toolId) {
        continue;
      }

      const toolName = readString(parsedBlock.name) ?? "Tool";
      const input = readRecord(parsedBlock.input) ?? {};
      const entry = createActiveToolEntry(toolName, input, nowMs);
      subagentTools.set(toolId, entry);
      setLastActivity(state, entry.statusText, entry.activityTool, entry.activityPath);
    }

    state.waiting = false;
    state.busyUntilMs = nowMs + textIdleDelayMs;
    return;
  }

  if (messageType === "user") {
    const subagentTools = state.activeSubagentTools.get(parentToolId);
    if (!subagentTools) {
      return;
    }

    for (const block of content) {
      const parsedBlock = readRecord(block);
      if (!parsedBlock || readString(parsedBlock.type) !== "tool_result") {
        continue;
      }

      const completedToolId = readString(parsedBlock.tool_use_id);
      if (!completedToolId) {
        continue;
      }

      subagentTools.delete(completedToolId);
    }

    if (subagentTools.size === 0) {
      state.activeSubagentTools.delete(parentToolId);
    }

    state.waiting = false;
    state.busyUntilMs = nowMs + textIdleDelayMs;
  }
}

function createActiveToolEntry(toolName: string, input: Record<string, unknown>, nowMs: number): ActiveToolEntry {
  const normalizedTool = normalizeToolName(toolName);
  const activityPath = extractPathFromInput(input);

  return {
    toolName,
    statusText: formatToolStatus(normalizedTool, toolName, input, activityPath),
    activityTool: mapActivityTool(normalizedTool),
    activityPath,
    startedAtMs: nowMs,
    lastProgressAtMs: nowMs
  };
}

function formatToolStatus(
  normalizedToolName: string,
  rawToolName: string,
  input: Record<string, unknown>,
  activityPath: string | undefined
): string {
  switch (normalizedToolName) {
    case "read":
      return activityPath ? `Reading ${path.basename(activityPath)}` : "Reading";
    case "edit":
      return activityPath ? `Editing ${path.basename(activityPath)}` : "Editing";
    case "write":
      return activityPath ? `Writing ${path.basename(activityPath)}` : "Writing";
    case "bash": {
      const command = extractCommandText(input);
      if (!command) {
        return "Running command";
      }

      return `Running: ${truncate(command, bashCommandDisplayMaxLength)}`;
    }
    case "glob":
    case "grep":
      return "Searching code";
    case "task": {
      const description = typeof input.description === "string" ? input.description.trim() : "";
      return description ? `Subtask: ${truncate(description, taskDescriptionDisplayMaxLength)}` : "Running subtask";
    }
    case "askuserquestion":
      return "Waiting for your answer";
    case "todowrite":
      return "Planning";
    case "webfetch":
    case "websearch":
      return "Fetching web content";
    case "enterplanmode":
      return "Planning";
    default:
      return `Using ${rawToolName}`;
  }
}

function mapActivityTool(normalizedToolName: string): ActivityTool | undefined {
  switch (normalizedToolName) {
    case "read":
      return "read";
    case "edit":
      return "edit";
    case "write":
      return "write";
    case "bash":
      return "bash";
    case "grep":
      return "grep";
    case "glob":
      return "glob";
    case "task":
      return "task";
    case "todowrite":
      return "todo";
    case "webfetch":
    case "websearch":
      return "web";
    case "askuserquestion":
      return "terminal";
    default:
      return "unknown";
  }
}

function extractPathFromInput(input: Record<string, unknown>): string | undefined {
  const keys = ["file_path", "filePath", "path", "target_path", "targetPath"];
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function extractCommandText(input: Record<string, unknown>): string | undefined {
  const command = input.command;
  if (typeof command === "string") {
    return command.trim() || undefined;
  }

  if (Array.isArray(command)) {
    const parts = command.filter((part): part is string => typeof part === "string");
    const joined = parts.join(" ").trim();
    return joined || undefined;
  }

  return undefined;
}

function setLastActivity(
  state: ClaudeTranscriptState,
  text: string,
  tool: ActivityTool | undefined,
  activityPath: string | undefined
): void {
  state.lastActivityText = text;
  state.lastActivityTool = tool;
  state.lastActivityPath = activityPath;
}

function touchTool(tool: ActiveToolEntry | undefined, nowMs: number): void {
  if (!tool) {
    return;
  }

  tool.lastProgressAtMs = nowMs;
}

function listActiveTools(state: ClaudeTranscriptState): ActiveToolEntry[] {
  const entries: ActiveToolEntry[] = [];

  for (const entry of state.activeTools.values()) {
    entries.push(entry);
  }

  for (const subagentTools of state.activeSubagentTools.values()) {
    for (const entry of subagentTools.values()) {
      entries.push(entry);
    }
  }

  return entries;
}

function clearActiveTools(state: ClaudeTranscriptState): void {
  state.activeTools.clear();
  state.activeSubagentTools.clear();
}

function resetTranscriptState(state: ClaudeTranscriptState): void {
  state.fileOffset = 0;
  state.lineBuffer = "";
  state.initialized = false;
  state.seenTranscriptRecord = false;
  state.waiting = false;
  state.hadToolsInTurn = false;
  state.lastEventAtMs = 0;
  state.busyUntilMs = 0;
  state.lastActivityText = undefined;
  state.lastActivityTool = undefined;
  state.lastActivityPath = undefined;
  state.activeTools.clear();
  state.activeSubagentTools.clear();
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

function isLikelyClaudeWorker(worker: Worker, paneCurrentCommand: string): boolean {
  if (worker.runtimeId.toLowerCase().includes("claude")) {
    return true;
  }

  const runtimeBinary = commandBinary(worker.command);
  if (runtimeBinary.includes("claude")) {
    return true;
  }

  return paneCurrentCommand.toLowerCase().includes("claude");
}

function commandBinary(command: string[]): string {
  if (command.length === 0) {
    return "";
  }

  return path.basename(command[0] ?? "").toLowerCase();
}

function normalizeToolName(toolName: string): string {
  return toolName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function parseRecord(line: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    return readRecord(parsed) ?? undefined;
  } catch {
    return undefined;
  }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function readArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
