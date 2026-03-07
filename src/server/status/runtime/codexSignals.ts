export interface CodexSignals {
  prompt: boolean;
  active: boolean;
}

const codexSignalWindowLines = 240;
const codexPromptFreshLineWindow = 24;
const codexActiveFreshLineWindow = 12;

const codexPromptMatchers: RegExp[] = [
  /needs your approval\./i,
  /^would you like to run the following command\?/i,
  /^would you like to make the following edits\?/i,
  /^do you want to approve network access to /i,
  /^permission rule:/i,
  /^yes, just this once$/i,
  /^yes, and don't ask again/i,
  /^yes, and allow these permissions for this session$/i,
  /^yes, and allow this host /i,
  /^yes, provide the requested info$/i,
  /^no, but continue without it$/i,
  /^no, continue without running it$/i,
  /^no, and tell codex what to do differently$/i,
  /^cancel this request$/i
];

const codexPromptStatusMatchers: RegExp[] = [
  /\bwaiting on approval\b/i,
  /\bwaiting on user input\b/i,
  /\bapproval[-\s]requested\b/i,
  /\buser[-\s]input[-\s]requested\b/i,
  /\bquestion requested\b/i
];

const codexActiveMatchers: RegExp[] = [/\besc to interrupt\b/i];

export function detectCodexSignals(output: string): CodexSignals {
  const lines = output
    .split("\n")
    .slice(-codexSignalWindowLines)
    .map((line) => normalizeCodexRuntimeLine(line))
    .filter((line) => line.length > 0);

  const newestIndex = lines.length - 1;
  const latestPromptIndex = findLastMatchingIndex(lines, (line) => isCodexPromptLine(line) || hasCodexPromptStatus(line));
  const latestActiveIndex = findLastMatchingIndex(lines, (line) => codexActiveMatchers.some((matcher) => matcher.test(line)));

  return {
    prompt:
      latestPromptIndex >= 0 &&
      newestIndex >= 0 &&
      newestIndex - latestPromptIndex <= codexPromptFreshLineWindow,
    active:
      latestActiveIndex >= 0 &&
      newestIndex >= 0 &&
      newestIndex - latestActiveIndex <= codexActiveFreshLineWindow
  };
}

export function hasCodexPromptSignal(output: string): boolean {
  return detectCodexSignals(output).prompt;
}

export function hasCodexActiveSignal(output: string): boolean {
  return detectCodexSignals(output).active;
}

export function extractCodexStatusText(line: string): string | undefined {
  const match = normalizeCodexRuntimeLine(line).match(/^status:\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

export function normalizeCodexRuntimeLine(line: string): string {
  const normalized = line
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b-\u001a\u001c-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  const withoutFrame = normalized.replace(/^[│┃╹▀▣⬝■•·]+/, "").trim();
  if (!withoutFrame || /^╹?▀+$/.test(withoutFrame)) {
    return "";
  }

  return withoutFrame;
}

function hasCodexPromptStatus(line: string): boolean {
  const statusText = extractCodexStatusText(line);
  return statusText ? codexPromptStatusMatchers.some((matcher) => matcher.test(statusText)) : false;
}

function isCodexPromptLine(line: string): boolean {
  return codexPromptMatchers.some((matcher) => matcher.test(line));
}

function findLastMatchingIndex(lines: string[], predicate: (line: string) => boolean): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (predicate(lines[index] ?? "")) {
      return index;
    }
  }

  return -1;
}
