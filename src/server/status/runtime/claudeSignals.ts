export interface ClaudeSignals {
  prompt: boolean;
  active: boolean;
}

const claudeSignalWindowLines = 120;
const claudePromptFreshLineWindow = 8;
const claudeActiveFreshLineWindow = 12;

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
  return line
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b-\u001a\u001c-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findLastMatchingIndex(lines: string[], predicate: (line: string) => boolean): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (predicate(lines[index] ?? "")) {
      return index;
    }
  }

  return -1;
}
