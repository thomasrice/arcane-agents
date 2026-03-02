import type { Worker } from "../../shared/types";

const defaultCapturePaneLines = 35;
const claudeCapturePaneLines = 60;
const openCodeCapturePaneLines = 420;
const openCodeThinkingContinuationMaxLines = 3;

export function capturePaneLineCount(worker: Worker, commandLower: string): number {
  if (isLikelyOpenCodeSession(worker, commandLower)) {
    return openCodeCapturePaneLines;
  }

  if (isLikelyClaudeSession(worker, commandLower)) {
    return claudeCapturePaneLines;
  }

  return defaultCapturePaneLines;
}

export function extractClaudeActiveTask(output: string): string | undefined {
  const linesNewestFirst = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-120)
    .reverse();

  for (const line of linesNewestFirst) {
    const parentheticalMatch = line.match(/^(?:\*|•|·|✶|✻|✢|✽)\s+(.+?)\s+\((?:[^)]*(?:thinking|thought\s+for)[^)]*)\)\s*$/i);
    const plainProgressMatch = line.match(/^(?:\*|•|·|✶|✻|✢|✽)\s+(.+?)\s*$/);
    const task = parentheticalMatch?.[1]?.trim() ?? plainProgressMatch?.[1]?.trim();
    if (task) {
      if (isGenericClaudeProgressLabel(task)) {
        continue;
      }

      return task;
    }
  }

  return undefined;
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

export function hasActiveWorkActivityText(activityText: string | undefined): boolean {
  if (!activityText) {
    return false;
  }

  const normalized = activityText.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return /^(reading|editing|writing|running:?|searching|searched|subtask:|using|fetching|planning|responding|let me|fixing)/.test(normalized);
}

export function hasWaitingActivityText(activityText: string | undefined): boolean {
  if (!activityText) {
    return false;
  }

  const normalized = activityText.trim().toLowerCase();
  return normalized.includes("waiting for your answer") || normalized.includes("waiting for approval");
}

export function hasClaudeLiveProgressSignal(output: string): boolean {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-60);

  for (const line of lines) {
    const progressMatch = line.match(/^(?:\*|•|·|✶|✻|✢|✽)\s+(.+?)\s*$/);
    if (!progressMatch?.[1]) {
      continue;
    }

    const progressText = progressMatch[1].trim();
    if (!progressText) {
      continue;
    }

    if (!isGenericClaudeProgressLabel(progressText)) {
      return true;
    }

    if (/\bfor\s+\d+[ms]\b/i.test(progressText) || /\((?:[^)]*(?:thinking|thought\s+for)[^)]*)\)/i.test(line)) {
      return true;
    }
  }

  return false;
}

export function isGenericClaudeProgressLabel(text: string): boolean {
  const normalized = text
    .trim()
    .replace(/[.…]+$/, "")
    .toLowerCase();

  return /^(?:whirring|thinking|saut[eé]ed|churned|baked|accomplishing|conversation compacted)\b/.test(normalized);
}

export function hasOpenCodePromptSignal(output: string): boolean {
  const lines = output
    .split("\n")
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0)
    .slice(-24);

  const hasVariantHint = lines.some((line) => line.includes("ctrl+t variants"));
  const hasCommandHint = lines.some((line) => line.includes("ctrl+p commands"));
  return hasVariantHint && hasCommandHint;
}

export function hasOpenCodeActiveSignal(output: string): boolean {
  const lines = output
    .split("\n")
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0)
    .slice(-24);

  return lines.some((line) => line.includes("esc interrupt"));
}

export function extractRuntimeActivityText(worker: Worker, currentCommand: string, output: string): string | undefined {
  const commandLower = currentCommand.toLowerCase();
  if (isLikelyClaudeSession(worker, commandLower)) {
    return extractClaudeRuntimeActivityText(output);
  }

  if (isLikelyOpenCodeSession(worker, commandLower)) {
    return extractOpenCodeRuntimeActivityText(output);
  }

  return undefined;
}

export function preferOpenCodeSpecificActivityText(
  previousActivityText: string | undefined,
  nextActivityText: string | undefined
): string | undefined {
  if (!nextActivityText || nextActivityText.trim().toLowerCase() !== "responding") {
    return nextActivityText;
  }

  if (!previousActivityText) {
    return nextActivityText;
  }

  const previousThinkingMatch = previousActivityText.trim().match(/^Thinking:\s+(.+)$/i);
  if (previousThinkingMatch?.[1]) {
    return previousActivityText;
  }

  return nextActivityText;
}

function extractClaudeRuntimeActivityText(output: string): string | undefined {
  const linesNewestFirst = recentLinesNewestFirst(output, 100);

  for (const line of linesNewestFirst) {
    const normalized = line.trim();
    const bulletActivity = extractClaudeBulletActivityText(normalized);
    if (bulletActivity) {
      return truncateActivityText(bulletActivity, 72);
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

function extractOpenCodeRuntimeActivityText(output: string): string | undefined {
  const latestThinkingText = extractLatestOpenCodeThinkingActivity(output);
  if (latestThinkingText) {
    return latestThinkingText;
  }

  const linesNewestFirst = recentLinesNewestFirst(output, openCodeCapturePaneLines);
  let hasActiveSignal = false;

  for (const line of linesNewestFirst) {
    const normalized = normalizeOpenCodeRuntimeLine(line);
    if (!normalized) {
      continue;
    }

    const thinkingMatch = normalized.match(/\bThinking:\s+(.+)$/i);
    if (thinkingMatch?.[1]) {
      return `Thinking: ${truncateActivityText(thinkingMatch[1].trim(), 72)}`;
    }

    const patchedMatch = normalized.match(/^←\s+Patched\s+(.+)$/i);
    if (patchedMatch?.[1]) {
      return `Editing ${patchedMatch[1].trim()}`;
    }

    const commandMatch = normalized.match(/^\$\s+(.+)$/);
    if (commandMatch?.[1]) {
      return `Running ${summarizeCommand(commandMatch[1])}`;
    }

    const headerMatch = normalized.match(/^#\s+(.+)$/);
    if (headerMatch?.[1]) {
      return truncateActivityText(headerMatch[1], 52);
    }

    if (normalized.toLowerCase().includes("esc interrupt")) {
      hasActiveSignal = true;
    }
  }

  if (hasActiveSignal) {
    return "Responding";
  }

  return undefined;
}

function extractLatestOpenCodeThinkingActivity(output: string): string | undefined {
  const normalizedLines = output
    .split("\n")
    .slice(-openCodeCapturePaneLines)
    .map((line) => normalizeOpenCodeRuntimeLine(line));

  for (let index = normalizedLines.length - 1; index >= 0; index -= 1) {
    const line = normalizedLines[index];
    if (!line) {
      continue;
    }

    const thinkingMatch = line.match(/\bThinking:\s+(.+)$/i);
    if (!thinkingMatch?.[1]) {
      continue;
    }

    const fragments: string[] = [thinkingMatch[1].trim()];

    for (
      let continuationIndex = index + 1, continuationCount = 0;
      continuationIndex < normalizedLines.length && continuationCount < openCodeThinkingContinuationMaxLines;
      continuationIndex += 1
    ) {
      const continuation = normalizedLines[continuationIndex];
      if (!continuation || isOpenCodeRuntimeBoundaryLine(continuation)) {
        break;
      }

      fragments.push(continuation);
      continuationCount += 1;
    }

    const combined = fragments.join(" ").replace(/\s+/g, " ").trim();
    if (!combined) {
      return undefined;
    }

    return `Thinking: ${truncateActivityText(combined, 72)}`;
  }

  return undefined;
}

function isOpenCodeRuntimeBoundaryLine(line: string): boolean {
  const normalized = line.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (normalized.includes("ctrl+t variants") || normalized.includes("ctrl+p commands") || normalized.includes("tab agents")) {
    return true;
  }

  if (normalized.includes("esc interrupt")) {
    return true;
  }

  if (/^thinking:\s+/i.test(line)) {
    return true;
  }

  if (/^#\s+/.test(line)) {
    return true;
  }

  if (/^\$\s+/.test(line)) {
    return true;
  }

  if (/^←\s+patched\s+/i.test(line)) {
    return true;
  }

  if (/^▣\s+/.test(line) || /^build\s+gpt/i.test(line)) {
    return true;
  }

  return false;
}

function normalizeOpenCodeRuntimeLine(line: string): string {
  const normalized = line
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b-\u001a\u001c-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  const withoutFrame = normalized.replace(/^[│┃]\s*/, "").trim();
  if (/^╹?▀+$/.test(withoutFrame)) {
    return "";
  }

  return withoutFrame;
}

function recentLinesNewestFirst(output: string, limit: number): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-limit)
    .reverse();
}

function summarizeCommand(command: string): string {
  const compact = command.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "command";
  }

  return truncateActivityText(compact, 46);
}

function truncateActivityText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  if (maxLength <= 1) {
    return text.slice(0, Math.max(0, maxLength));
  }

  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}
