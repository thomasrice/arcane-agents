import type { Worker } from "../../../shared/types";
import type { RuntimeAdapter, RuntimeSignals } from "./adapter";
import { findLastMatchingIndex, stripTerminalControlSequences, truncateWithEllipsis } from "./terminalText";

const captureLines = 420;
const freshnessWindowMs = 10_000;
const spawnGraceMs = 5_000;

const codexSignalWindowLines = 240;
const codexPromptFreshLineWindow = 24;
const codexActiveFreshLineWindow = 12;

interface CodexSignals {
  /** An approval / permission / question dialog — routes to attention. */
  approval: boolean;
  /** A completed response whose final line asks the user a question. */
  question: boolean;
  /** A live turn ("esc to interrupt") — routes to working. */
  active: boolean;
  /**
   * The codex UI parked at its input box (the "›" prompt plus the persistent
   * status footer). This is the finished/at-rest state — distinct from an
   * approval request — and is used to CLASSIFY the pane as codex without
   * implying attention or work.
   */
  atInputPrompt: boolean;
}

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

// At rest, Codex shows a "›" input box and a persistent model · cwd footer.
// Legacy builds append rate-limit / [default] fields; current builds may stop
// after the working directory or add Goal state instead. Prompt + footer are
// both required so neither an arbitrary "›" nor a generic path line can
// classify a pane alone.
const codexInputPromptMatchers: RegExp[] = [/^›(?:\s|$)/];
const codexFooterMatchers: RegExp[] = [
  /^(?:gpt-|o\d(?:\b|-)|codex\b)[^·\n]*·\s*(?:~\/|\/)\S+/i,
  /·\s*(?:weekly|daily|hourly|monthly)\s+\d+%\s+left\b/i,
  /\[default\]\s*$/i
];

export const codexAdapter: RuntimeAdapter = {
  id: "codex",
  displayName: "Codex",
  captureLines,
  freshnessWindowMs,
  spawnGraceMs,
  matches(worker, commandLower, wrappedRuntime) {
    return wrappedRuntime === "codex" || isLikelyCodexSession(worker, commandLower);
  },
  detect(output): RuntimeSignals {
    const signals = detectCodexSignals(output);
    return {
      // `prompt` means "codex is parked, not mid-turn" — an approval dialog, a
      // response ending in a question, or the at-rest input prompt. The decision
      // layer distinguishes the states through the dedicated waiting signals.
      prompt: signals.approval || signals.question || signals.atInputPrompt,
      active: signals.active,
      activityText: extractCodexRuntimeActivityText(output, signals),
      activeTask: undefined,
      awaitingInput: signals.question,
      awaitingApproval: signals.approval
    };
  }
};

export function isLikelyCodexSession(worker: Worker, commandLower: string): boolean {
  if (worker.runtimeId.toLowerCase().includes("codex")) {
    return true;
  }

  const runtimeBinary = worker.command[0]?.toLowerCase() ?? "";
  if (runtimeBinary.includes("codex")) {
    return true;
  }

  return commandLower.includes("codex");
}

function detectCodexSignals(output: string): CodexSignals {
  const lines = output
    .split("\n")
    .slice(-codexSignalWindowLines)
    .map((line) => normalizeCodexRuntimeLine(line))
    .filter((line) => line.length > 0);

  const newestIndex = lines.length - 1;
  const latestPromptIndex = findLastMatchingIndex(lines, (line) => isCodexPromptLine(line) || hasCodexPromptStatus(line));
  const latestActiveIndex = findLastMatchingIndex(lines, (line) => codexActiveMatchers.some((matcher) => matcher.test(line)));

  const latestInputPromptIndex = findLastMatchingIndex(lines, (line) =>
    codexInputPromptMatchers.some((matcher) => matcher.test(line))
  );
  const hasFooter = lines.some((line) => codexFooterMatchers.some((matcher) => matcher.test(line)));
  const atInputPrompt = latestInputPromptIndex >= 0 && hasFooter;

  return {
    approval:
      latestPromptIndex >= 0 &&
      newestIndex >= 0 &&
      newestIndex - latestPromptIndex <= codexPromptFreshLineWindow,
    question:
      atInputPrompt &&
      latestInputPromptIndex > 0 &&
      (lines[latestInputPromptIndex - 1]?.endsWith("?") ?? false),
    active:
      latestActiveIndex >= 0 &&
      newestIndex >= 0 &&
      newestIndex - latestActiveIndex <= codexActiveFreshLineWindow,
    atInputPrompt
  };
}

function extractCodexStatusText(line: string): string | undefined {
  const match = normalizeCodexRuntimeLine(line).match(/^status:\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

function normalizeCodexRuntimeLine(line: string): string {
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

function hasCodexPromptStatus(line: string): boolean {
  const statusText = extractCodexStatusText(line);
  return statusText ? codexPromptStatusMatchers.some((matcher) => matcher.test(statusText)) : false;
}

function isCodexPromptLine(line: string): boolean {
  return codexPromptMatchers.some((matcher) => matcher.test(line));
}

function extractCodexRuntimeActivityText(output: string, signals: CodexSignals): string | undefined {
  const linesNewestFirst = output
    .split("\n")
    .slice(-captureLines)
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

    return truncateWithEllipsis(statusText, 72);
  }

  if (signals.approval) {
    return "Waiting for approval";
  }
  if (signals.question) {
    return "Waiting for input";
  }

  if (signals.active) {
    return "Responding";
  }

  return undefined;
}
