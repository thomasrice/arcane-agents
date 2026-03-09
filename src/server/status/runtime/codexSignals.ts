export interface CodexSignals {
  prompt: boolean;
  active: boolean;
}

const codexSignalWindowLines = 240;
const codexPromptFreshLineWindow = 24;
const codexActiveFreshLineWindow = 12;
const escapeChar = String.fromCharCode(0x1b);
const bellChar = String.fromCharCode(0x07);

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
  const normalized = stripTerminalControlSequences(line)
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
