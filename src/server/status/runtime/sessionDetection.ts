import type { Worker } from "../../../shared/types";

const defaultCapturePaneLines = 35;
const claudeCapturePaneLines = 60;
const openCodeCapturePaneLines = 420;
const codexCapturePaneLines = 420;

export function capturePaneLineCount(worker: Worker, commandLower: string): number {
  if (isLikelyOpenCodeSession(worker, commandLower)) {
    return openCodeCapturePaneLines;
  }

  if (isLikelyCodexSession(worker, commandLower)) {
    return codexCapturePaneLines;
  }

  if (isLikelyClaudeSession(worker, commandLower)) {
    return claudeCapturePaneLines;
  }

  return defaultCapturePaneLines;
}

export function isLikelyClaudeSession(worker: Worker, commandLower: string): boolean {
  if (worker.runtimeId.toLowerCase().includes("claude")) {
    return true;
  }

  const runtimeBinary = worker.command[0]?.toLowerCase() ?? "";
  if (runtimeBinary.includes("claude")) {
    return true;
  }

  return commandLower.includes("claude");
}

export function isLikelyOpenCodeSession(worker: Worker, commandLower: string): boolean {
  if (worker.runtimeId.toLowerCase().includes("opencode")) {
    return true;
  }

  const runtimeBinary = worker.command[0]?.toLowerCase() ?? "";
  if (runtimeBinary.includes("opencode")) {
    return true;
  }

  return commandLower.includes("opencode");
}

export function isLikelyCodexSession(worker: Worker, commandLower: string): boolean {
  if (worker.runtimeId.toLowerCase().includes("codex")) {
    return true;
  }

  const runtimeBinary = worker.command[0]?.toLowerCase() ?? "";
  if (runtimeBinary.includes("codex")) {
    return true;
  }

  return commandLower.includes("codex");
}
