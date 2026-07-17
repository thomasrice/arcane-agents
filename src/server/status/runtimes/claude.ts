import type { Worker } from "../../../shared/types";
import type { RuntimeAdapter, RuntimeSignals } from "./adapter";
import {
  findLastMatchingIndex,
  recentNonEmptyLinesNewestFirst,
  stripTerminalControlSequences,
  truncateWithEllipsis
} from "./terminalText";

const captureLines = 60;
const freshnessWindowMs = 10_000;
const spawnGraceMs = 5_000;

const claudeSignalWindowLines = 120;
const claudePromptFreshLineWindow = 8;
const claudeActiveFreshLineWindow = 12;

interface ClaudeSignals {
  prompt: boolean;
  active: boolean;
}

export const claudeAdapter: RuntimeAdapter = {
  id: "claude",
  displayName: "Claude",
  captureLines,
  freshnessWindowMs,
  spawnGraceMs,
  matches(worker, commandLower, wrappedRuntime) {
    return wrappedRuntime === "claude" || isLikelyClaudeSession(worker, commandLower);
  },
  detect(output): RuntimeSignals {
    const lines = recentClaudeLines(output);
    const signals = detectClaudeSignalsFromLines(lines);
    return {
      prompt: signals.prompt,
      active: signals.active,
      activityText: extractClaudeRuntimeActivityText(output),
      activeTask: extractClaudeActiveTaskFromLines(lines)
    };
  }
};

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

function detectClaudeSignalsFromLines(lines: string[]): ClaudeSignals {
  const newestIndex = lines.length - 1;
  const latestPromptIndex = findLastMatchingIndex(lines, isClaudePromptLine);
  const latestProgressIndex = findLastMatchingIndex(lines, isClaudeProgressLine);

  return {
    prompt:
      latestPromptIndex >= 0 &&
      newestIndex >= 0 &&
      newestIndex - latestPromptIndex <= claudePromptFreshLineWindow,
    active:
      latestProgressIndex >= 0 &&
      newestIndex >= 0 &&
      newestIndex - latestProgressIndex <= claudeActiveFreshLineWindow &&
      (latestPromptIndex < 0 || latestProgressIndex >= latestPromptIndex)
  };
}

function extractClaudeActiveTaskFromLines(lines: string[]): string | undefined {
  const latestPromptIndex = findLastMatchingIndex(lines, isClaudePromptLine);
  const lowerBound = latestPromptIndex >= 0 ? latestPromptIndex : 0;

  for (let index = lines.length - 1; index >= lowerBound; index -= 1) {
    const task = extractClaudeTaskText(lines[index] ?? "");
    if (task) {
      return task;
    }
  }

  return undefined;
}

function isGenericClaudeProgressLabel(text: string): boolean {
  const normalized = text
    .trim()
    .replace(/[.…]+$/, "")
    .toLowerCase();

  return /^(?:whirring|thinking|saut[eé]ed|churned|baked|accomplishing|conversation compacted)\b/.test(normalized);
}

function extractClaudeTaskText(line: string): string | undefined {
  const task = extractClaudeBulletText(line);
  if (!task || isGenericClaudeProgressLabel(task)) {
    return undefined;
  }

  return task;
}

function isClaudeProgressLine(line: string): boolean {
  const progressText = extractClaudeBulletText(line);
  if (!progressText) {
    return false;
  }

  if (!isGenericClaudeProgressLabel(progressText)) {
    return true;
  }

  return /\bfor\s+\d+[ms]\b/i.test(progressText) || /\((?:[^)]*(?:thinking|thought\s+for)[^)]*)\)/i.test(line);
}

function extractClaudeBulletText(line: string): string | undefined {
  const parentheticalMatch = line.match(/^(?:\*|•|·|✶|✻|✢|✽)\s+(.+?)\s+\((?:[^)]*(?:thinking|thought\s+for)[^)]*)\)\s*$/i);
  const plainProgressMatch = line.match(/^(?:\*|•|·|✶|✻|✢|✽)\s+(.+?)\s*$/);
  return parentheticalMatch?.[1]?.trim() ?? plainProgressMatch?.[1]?.trim();
}

function isClaudePromptLine(line: string): boolean {
  return /^❯$/u.test(line) || /\bbypass permissions\b/i.test(line);
}

function recentClaudeLines(output: string): string[] {
  return output
    .split("\n")
    .map((line) => normalizeClaudeRuntimeLine(line))
    .filter((line) => line.length > 0)
    .slice(-claudeSignalWindowLines);
}

function normalizeClaudeRuntimeLine(line: string): string {
  return stripTerminalControlSequences(line)
    .replace(/\s+/g, " ")
    .trim();
}

function extractClaudeRuntimeActivityText(output: string): string | undefined {
  const linesNewestFirst = recentNonEmptyLinesNewestFirst(output, 100);

  for (const line of linesNewestFirst) {
    const normalized = line.trim();
    const bulletActivity = extractClaudeBulletActivityText(normalized);
    if (bulletActivity) {
      return truncateWithEllipsis(bulletActivity, 72);
    }
  }

  for (const line of linesNewestFirst) {
    const normalized = line.trim();
    if (/^✻\s+.+\bfor\s+\d+s\s*$/i.test(normalized)) {
      return "Thinking";
    }
  }

  return undefined;
}

function extractClaudeBulletActivityText(line: string): string | undefined {
  const bulletMatch = line.match(/^●\s+(.+)$/);
  if (!bulletMatch?.[1]) {
    return undefined;
  }

  let activityText = bulletMatch[1].replace(/\s+/g, " ").trim();
  if (!activityText) {
    return undefined;
  }

  if (/^Bash\(/i.test(activityText)) {
    return undefined;
  }

  activityText = activityText.replace(/\s*\(ctrl\+o to expand\)\s*$/i, "").trim();
  if (!activityText) {
    return undefined;
  }

  const updateMatch = activityText.match(/^Update\((.+)\)$/i);
  if (updateMatch?.[1]) {
    return `Editing ${updateMatch[1].trim()}`;
  }

  return activityText;
}
