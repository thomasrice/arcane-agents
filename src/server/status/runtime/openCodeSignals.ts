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
