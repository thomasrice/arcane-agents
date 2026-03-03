export interface OpenCodeSignals {
  prompt: boolean;
  active: boolean;
}

export function detectOpenCodeSignals(output: string): OpenCodeSignals {
  const lines = output
    .split("\n")
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0)
    .slice(-24);

  const hasVariantHint = lines.some((line) => line.includes("ctrl+t variants"));
  const hasCommandHint = lines.some((line) => line.includes("ctrl+p commands"));

  return {
    prompt: hasVariantHint && hasCommandHint,
    active: lines.some((line) => line.includes("esc interrupt"))
  };
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
