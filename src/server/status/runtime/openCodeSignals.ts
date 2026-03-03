export interface OpenCodeSignals {
  prompt: boolean;
  active: boolean;
}

const openCodeSignalWindowLines = 64;
const openCodePromptFreshLineWindow = 10;
const openCodeActiveFreshLineWindow = 8;
const openCodeActivePromptDriftLines = 2;

export function detectOpenCodeSignals(output: string): OpenCodeSignals {
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

  const prompt = promptHintIsFresh;
  const active = activeSignalIsFresh && activeSignalAlignedWithPrompt;

  return {
    prompt,
    active
  };
}

function findLastMatchingIndex(lines: string[], predicate: (line: string) => boolean): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (predicate(lines[index] ?? "")) {
      return index;
    }
  }

  return -1;
}

export function hasOpenCodePromptSignal(output: string): boolean {
  return detectOpenCodeSignals(output).prompt;
}

export function hasOpenCodeActiveSignal(output: string): boolean {
  return detectOpenCodeSignals(output).active;
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
