export interface ClaudeSignals {
  prompt: boolean;
  active: boolean;
}

const claudeSignalWindowLines = 120;
const claudePromptFreshLineWindow = 8;
const claudeActiveFreshLineWindow = 12;
const escapeChar = String.fromCharCode(0x1b);
const bellChar = String.fromCharCode(0x07);

export function extractClaudeActiveTask(output: string): string | undefined {
  const lines = recentClaudeLines(output);
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

export function hasClaudeLiveProgressSignal(output: string): boolean {
  return detectClaudeSignals(output).active;
}

export function hasClaudePromptSignal(output: string): boolean {
  return detectClaudeSignals(output).prompt;
}

export function detectClaudeSignals(output: string): ClaudeSignals {
  const lines = recentClaudeLines(output);
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

export function isGenericClaudeProgressLabel(text: string): boolean {
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
  return /^\u276f$/u.test(line) || /^--\s*insert\s*--.*\bbypass permissions\b/i.test(line) || /\bbypass permissions\b/i.test(line);
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

function stripTerminalControlSequences(line: string): string {
  let normalized = "";

  for (let index = 0; index < line.length; index += 1) {
    const current = line[index] ?? "";
    const next = line[index + 1] ?? "";

    if (current === escapeChar && next === "]") {
      index += 2;
      while (index < line.length) {
        const cursor = line[index] ?? "";
        const following = line[index + 1] ?? "";
        if (cursor === bellChar) {
          break;
        }
        if (cursor === escapeChar && following === "\\") {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (current === escapeChar && next === "[") {
      index += 2;
      while (index < line.length) {
        const code = line.charCodeAt(index);
        if (code >= 0x40 && code <= 0x7e) {
          break;
        }
        index += 1;
      }
      continue;
    }

    const code = current.charCodeAt(0);
    if ((code >= 0x00 && code <= 0x08) || (code >= 0x0b && code <= 0x1a) || (code >= 0x1c && code <= 0x1f) || code === 0x7f) {
      continue;
    }

    normalized += current;
  }

  return normalized;
}

function findLastMatchingIndex(lines: string[], predicate: (line: string) => boolean): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (predicate(lines[index] ?? "")) {
      return index;
    }
  }

  return -1;
}
