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
