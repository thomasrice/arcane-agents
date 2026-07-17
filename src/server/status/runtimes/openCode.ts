import type { Worker } from "../../../shared/types";
import type { RuntimeAdapter, RuntimeSignals } from "./adapter";
import { findLastMatchingIndex, recentNonEmptyLinesNewestFirst, truncateWithEllipsis } from "./terminalText";

const captureLines = 420;
const freshnessWindowMs = 12_000;
const spawnGraceMs = 5_000;

const openCodeSignalWindowLines = 64;
const openCodePromptFreshLineWindow = 10;
const openCodeActiveFreshLineWindow = 8;
const openCodeActivePromptDriftLines = 2;
const openCodeThinkingContinuationMaxLines = 3;

interface OpenCodeSignals {
  prompt: boolean;
  active: boolean;
}

export const openCodeAdapter: RuntimeAdapter = {
  id: "opencode",
  displayName: "OpenCode",
  captureLines,
  freshnessWindowMs,
  spawnGraceMs,
  matches(worker, commandLower, wrappedRuntime) {
    return wrappedRuntime === "opencode" || isLikelyOpenCodeSession(worker, commandLower);
  },
  detect(output): RuntimeSignals {
    const signals = detectOpenCodeSignals(output);
    return {
      prompt: signals.prompt,
      active: signals.active,
      activityText: extractOpenCodeRuntimeActivityText(output),
      activeTask: undefined
    };
  }
};

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

function detectOpenCodeSignals(output: string): OpenCodeSignals {
  const lines = output
    .split("\n")
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0)
    .slice(-openCodeSignalWindowLines);

  const newestIndex = lines.length - 1;
  const latestVariantHintIndex = findLastMatchingIndex(lines, (line) => line.includes("ctrl+t variants"));
  const latestCommandHintIndex = findLastMatchingIndex(lines, (line) => line.includes("ctrl+p commands"));
  const latestPromptHintIndex = Math.max(latestVariantHintIndex, latestCommandHintIndex);

  const hasPromptHints = latestVariantHintIndex >= 0 && latestCommandHintIndex >= 0;
  const promptHintIsFresh =
    hasPromptHints &&
    newestIndex >= 0 &&
    newestIndex - latestPromptHintIndex <= openCodePromptFreshLineWindow;

  const latestActiveSignalIndex = findLastMatchingIndex(lines, (line) => line.includes("esc interrupt"));
  const activeSignalIsFresh =
    latestActiveSignalIndex >= 0 &&
    newestIndex >= 0 &&
    newestIndex - latestActiveSignalIndex <= openCodeActiveFreshLineWindow;
  const activeSignalAlignedWithPrompt =
    latestPromptHintIndex < 0 || latestActiveSignalIndex >= latestPromptHintIndex - openCodeActivePromptDriftLines;

  return {
    prompt: promptHintIsFresh,
    active: activeSignalIsFresh && activeSignalAlignedWithPrompt
  };
}

function extractOpenCodeRuntimeActivityText(output: string): string | undefined {
  const latestThinkingText = extractLatestOpenCodeThinkingActivity(output);
  if (latestThinkingText) {
    return latestThinkingText;
  }

  const linesNewestFirst = recentNonEmptyLinesNewestFirst(output, captureLines);
  let hasActiveSignal = false;

  for (const line of linesNewestFirst) {
    const normalized = normalizeOpenCodeRuntimeLine(line);
    if (!normalized) {
      continue;
    }

    const thinkingMatch = normalized.match(/\bThinking:\s+(.+)$/i);
    if (thinkingMatch?.[1]) {
      return `Thinking: ${truncateWithEllipsis(thinkingMatch[1].trim(), 72)}`;
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
      return truncateWithEllipsis(headerMatch[1], 52);
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
    .slice(-captureLines)
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

    return `Thinking: ${truncateWithEllipsis(combined, 72)}`;
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
  const normalized = stripOpenCodeControlSequences(line)
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

function stripOpenCodeControlSequences(line: string): string {
  return line
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b-\u001a\u001c-\u001f\u007f]/g, "");
}

function summarizeCommand(command: string): string {
  const compact = command.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "command";
  }

  return truncateWithEllipsis(compact, 46);
}
