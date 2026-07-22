import type { Worker } from "../../../shared/types";
import type { RuntimeAdapter, RuntimeSignals } from "./adapter";
import { findLastMatchingIndex, stripTerminalControlSequences, truncateWithEllipsis } from "./terminalText";

// oh-my-pi (`omp`) is an agent CLI with its own TUI. Values mirror codex's — omp
// is an interpreter-hosted agent runtime with the same capture/freshness profile.
const captureLines = 420;
const freshnessWindowMs = 10_000;
const spawnGraceMs = 5_000;

const ompSignalWindowLines = 240;
const ompActiveFreshLineWindow = 12;

// A live omp turn draws a single spinner line: a Braille spinner glyph
// (U+2800–U+28FF: ⠋⠙⠧⠏…), the task text, then a "⟨esc⟩" interrupt hint. The pair
// (Braille glyph + ⟨esc⟩ on the same line) is unambiguous omp chrome — nothing
// else in the corpus draws it.
const ompBrailleSpinner = /[⠀-⣿]/;
const ompEscInterruptMarker = /⟨esc⟩/; // ⟨esc⟩
// OMP's prompt bar always carries a context meter. Older releases also showed a
// running dollar cost; the current July 2026 UI may omit it, but retains the
// distinctive ╭…╮ box-drawing bar. Context + either marker is runtime-specific
// without depending on optional cost display.
const ompContextMeterMarker = /\d+(?:\.\d+)?%\/\d+(?:\.\d+)?[KMG]?/;
const ompCostMarker = /\$\s?\d/;
const ompPromptBarMarker = /^╭.*╮$/u;
const ompAskHeader = /^╭─+\s*Ask\s*─+.*╮$/i;
const ompAskInputHint = /^(?:│|\|)\s*Enter select\b.*\bEsc cancel\s*(?:│|\|)$/i;
const ompFrameBottom = /^╰─+.*╯$/;
const ompAskFrameMaxLines = 40;

interface OmpSignals {
  /** A live turn — a fresh Braille spinner line ending in "⟨esc⟩". Routes to working. */
  active: boolean;
  /**
   * The omp UI parked at its footer chrome with no live spinner. This is the
   * finished/at-rest state, used to CLASSIFY the pane as omp (and suppress the
   * live child-process signal in the decision) without implying work.
   *
   * Current captured at-rest UI: the context-bearing prompt bar is present and
   * no live spinner appears in the fresh window. The optional dollar-cost field
   * is not required.
   */
  atFooterPrompt: boolean;
  /** A current Ask selector below the latest live spinner. Routes to attention. */
  awaitingInput: boolean;
}

export const ompAdapter: RuntimeAdapter = {
  id: "omp",
  displayName: "oh-my-pi",
  captureLines,
  freshnessWindowMs,
  spawnGraceMs,
  matches(worker, commandLower, wrappedRuntime) {
    return wrappedRuntime === "omp" || isLikelyOmpSession(worker, commandLower);
  },
  detect(output): RuntimeSignals {
    const signals = detectOmpSignals(output);
    return {
      prompt: signals.atFooterPrompt,
      active: signals.active,
      activityText: extractOmpRuntimeActivityText(output, signals),
      activeTask: undefined,
      awaitingInput: signals.awaitingInput
    };
  }
};

const ompTokenMatcher = /\bomp\b/;

export function isLikelyOmpSession(worker: Worker, commandLower: string): boolean {
  const runtimeIdLower = worker.runtimeId.toLowerCase();
  if (ompTokenMatcher.test(runtimeIdLower) || runtimeIdLower.includes("oh-my-pi")) {
    return true;
  }

  const runtimeBinary = worker.command[0]?.toLowerCase() ?? "";
  if (ompTokenMatcher.test(runtimeBinary) || runtimeBinary.includes("oh-my-pi")) {
    return true;
  }

  return ompTokenMatcher.test(commandLower) || commandLower.includes("oh-my-pi");
}

function detectOmpSignals(output: string): OmpSignals {
  const lines = output
    .split("\n")
    .slice(-ompSignalWindowLines)
    .map((line) => normalizeOmpRuntimeLine(line))
    .filter((line) => line.length > 0);

  const newestIndex = lines.length - 1;
  const latestActiveIndex = findLastMatchingIndex(lines, isOmpActiveLine);
  const latestInputIndex = findLatestOmpAskInputIndex(lines);
  const activeIsFresh =
    latestActiveIndex >= 0 && newestIndex >= 0 && newestIndex - latestActiveIndex <= ompActiveFreshLineWindow;
  const inputIsFresh =
    latestInputIndex >= 0 && newestIndex >= 0 && newestIndex - latestInputIndex <= ompActiveFreshLineWindow;
  const active = activeIsFresh && latestActiveIndex > latestInputIndex;
  const awaitingInput = inputIsFresh && latestInputIndex > latestActiveIndex;

  const hasFooter = lines.some(isOmpFooterLine);

  return {
    active,
    atFooterPrompt: hasFooter && !active && !awaitingInput,
    awaitingInput
  };
}

function isOmpActiveLine(line: string): boolean {
  return ompBrailleSpinner.test(line) && ompEscInterruptMarker.test(line);
}

function isOmpAskInputLine(line: string): boolean {
  return ompAskInputHint.test(line);
}

function findLatestOmpAskInputIndex(lines: string[]): number {
  const inputIndex = findLastMatchingIndex(lines, isOmpAskInputLine);
  if (inputIndex < 0) {
    return -1;
  }

  const oldestPossibleHeaderIndex = Math.max(0, inputIndex - ompAskFrameMaxLines);
  for (let index = inputIndex - 1; index >= oldestPossibleHeaderIndex; index -= 1) {
    const line = lines[index];
    if (!line || ompFrameBottom.test(line)) {
      return -1;
    }
    if (ompAskHeader.test(line)) {
      return inputIndex;
    }
  }

  return -1;
}

function isOmpFooterLine(line: string): boolean {
  return ompContextMeterMarker.test(line) && (ompCostMarker.test(line) || ompPromptBarMarker.test(line));
}

function extractOmpRuntimeActivityText(output: string, signals: OmpSignals): string | undefined {
  if (!signals.active) {
    return undefined;
  }

  const linesNewestFirst = output
    .split("\n")
    .slice(-captureLines)
    .map((line) => normalizeOmpRuntimeLine(line))
    .filter((line) => line.length > 0)
    .reverse();

  for (const line of linesNewestFirst) {
    if (!isOmpActiveLine(line)) {
      continue;
    }

    const task = extractOmpSpinnerTask(line);
    if (task) {
      return truncateWithEllipsis(task, 72);
    }

    break;
  }

  return "Responding";
}

function extractOmpSpinnerTask(line: string): string | undefined {
  const withoutEsc = line.replace(/\s*⟨esc⟩\s*$/, "").trim();
  const withoutSpinner = withoutEsc.replace(/^[⠀-⣿]+\s*/, "").trim();
  return withoutSpinner.length > 0 ? withoutSpinner : undefined;
}

function normalizeOmpRuntimeLine(line: string): string {
  return stripTerminalControlSequences(line)
    .replace(/\s+/g, " ")
    .trim();
}
