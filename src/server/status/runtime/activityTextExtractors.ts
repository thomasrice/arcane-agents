import { detectCodexSignals, extractCodexStatusText, normalizeCodexRuntimeLine } from "./codexSignals";

interface SessionContext {
  isClaude: boolean;
  isOpenCode: boolean;
  isCodex: boolean;
}

const openCodeCapturePaneLines = 420;
const openCodeThinkingContinuationMaxLines = 3;
const codexCapturePaneLines = 240;

export function extractRuntimeActivityText(output: string, session: SessionContext): string | undefined {
  if (session.isClaude) {
    return extractClaudeRuntimeActivityText(output);
  }

  if (session.isOpenCode) {
    return extractOpenCodeRuntimeActivityText(output);
  }

  if (session.isCodex) {
    return extractCodexRuntimeActivityText(output);
  }

  return undefined;
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

function extractCodexRuntimeActivityText(output: string): string | undefined {
  const signals = detectCodexSignals(output);
  const linesNewestFirst = output
    .split("\n")
    .slice(-codexCapturePaneLines)
    .map((line) => normalizeCodexRuntimeLine(line))
    .filter((line) => line.length > 0)
    .reverse();

  for (const line of linesNewestFirst) {
    const statusText = extractCodexStatusText(line);
    if (!statusText) {
      continue;
    }

    const normalizedStatus = statusText.toLowerCase();
    if (normalizedStatus.includes("waiting on approval") || normalizedStatus.includes("approval requested")) {
      return "Waiting for approval";
    }

    if (
      normalizedStatus.includes("waiting on user input") ||
      normalizedStatus.includes("question requested") ||
      normalizedStatus.includes("user input requested")
    ) {
      return "Waiting for input";
    }

    if (normalizedStatus === "finished" || normalizedStatus.includes("agent turn complete")) {
      return undefined;
    }

    return truncateActivityText(statusText, 72);
  }

  if (signals.prompt) {
    return "Waiting for approval";
  }

  if (signals.active) {
    return "Responding";
  }

  return undefined;
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
