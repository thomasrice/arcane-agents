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
// The persistent footer: a box-drawing line carrying the model name, the context
// meter (e.g. "39.3%/272K") and the running $ cost. Requiring BOTH the context
// meter and the cost marker on one line makes it strongly omp-specific, so a
// stray "$" or "%" elsewhere can't misclassify a pane.
const ompContextMeterMarker = /\d+(?:\.\d+)?%\/\d+/;
const ompCostMarker = /\$\s?\d/;

interface OmpSignals {
  /** A live turn — a fresh Braille spinner line ending in "⟨esc⟩". Routes to working. */
  active: boolean;
  /**
   * The omp UI parked at its footer chrome with no live spinner. This is the
   * finished/at-rest state, used to CLASSIFY the pane as omp (and suppress the
   * live child-process signal in the decision) without implying work.
   *
   * APPROXIMATION: a real AT-REST omp capture is not yet available (a watcher is
   * collecting one). Until then the at-rest prompt is inferred as "footer chrome
   * present AND no live spinner in the fresh window". TODO: once the at-rest
   * fixture lands in omp.test.ts, tighten this against the real parked UI (e.g. a
   * dedicated input-box glyph) if it differs.
   */
  atFooterPrompt: boolean;
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
      // `prompt` means "omp is parked, not mid-turn" (footer chrome, no live
      // spinner). It classifies the pane as omp; the decision layer treats it as
      // at-rest (suppresses the child-process signal, falls through to idle).
      prompt: signals.atFooterPrompt,
      active: signals.active,
      activityText: extractOmpRuntimeActivityText(output, signals),
      activeTask: undefined
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
  const active =
    latestActiveIndex >= 0 && newestIndex >= 0 && newestIndex - latestActiveIndex <= ompActiveFreshLineWindow;

  const hasFooter = lines.some(isOmpFooterLine);

  return {
    active,
    atFooterPrompt: hasFooter && !active
  };
}

function isOmpActiveLine(line: string): boolean {
  return ompBrailleSpinner.test(line) && ompEscInterruptMarker.test(line);
}

function isOmpFooterLine(line: string): boolean {
  return ompContextMeterMarker.test(line) && ompCostMarker.test(line);
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
