import path from "node:path";
import type { ActivityTool } from "../../../shared/types";
import {
  bashCommandDisplayMaxLength,
  taskDescriptionDisplayMaxLength,
  textIdleDelayMs
} from "./constants";
import { readArray, readRecord, readString } from "./parser";
import type { ActiveToolEntry, ClaudeTranscriptState, ParsedTranscriptRecord } from "./types";

export function createTranscriptState(): ClaudeTranscriptState {
  return {
    nextTranscriptLookupAtMs: 0,
    fileOffset: 0,
    lineBuffer: "",
    initialized: false,
    seenTranscriptRecord: false,
    activeTools: new Map(),
    activeSubagentTools: new Map(),
    waiting: false,
    lastEventAtMs: 0,
    busyUntilMs: 0,
    lastActivityText: undefined,
    lastActivityTool: undefined,
    lastActivityPath: undefined
  };
}

export function resetTranscriptState(state: ClaudeTranscriptState): void {
  state.fileOffset = 0;
  state.lineBuffer = "";
  state.initialized = false;
  state.seenTranscriptRecord = false;
  state.waiting = false;
  state.lastEventAtMs = 0;
  state.busyUntilMs = 0;
  state.lastActivityText = undefined;
  state.lastActivityTool = undefined;
  state.lastActivityPath = undefined;
  state.activeTools.clear();
  state.activeSubagentTools.clear();
}

export function applyParsedTranscriptRecords(state: ClaudeTranscriptState, records: ParsedTranscriptRecord[]): void {
  for (const parsedRecord of records) {
    const nowMs = Date.now();

    switch (parsedRecord.type) {
      case "assistant": {
        processAssistantRecord(state, parsedRecord.record, nowMs);
        break;
      }
      case "user": {
        processUserRecord(state, parsedRecord.record, nowMs);
        break;
      }
      case "system": {
        processSystemRecord(state, parsedRecord.record);
        break;
      }
      case "progress": {
        processProgressRecord(state, parsedRecord.record, nowMs);
        break;
      }
      default: {
        break;
      }
    }

    state.seenTranscriptRecord = true;
    state.lastEventAtMs = nowMs;
  }
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
      state.busyUntilMs = nowMs + textIdleDelayMs;
      setLastActivity(state, "Responding", "terminal", undefined);
    }

    return;
  }

  if (typeof content === "string" && content.trim().length > 0) {
    clearActiveTools(state);
    state.waiting = false;
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

function clearActiveTools(state: ClaudeTranscriptState): void {
  state.activeTools.clear();
  state.activeSubagentTools.clear();
}

export function normalizeToolName(toolName: string): string {
  return toolName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}
