import { describe, expect, it } from "vitest";
import { ompAdapter } from "./omp";

// Fixtures marked "captured live" are verbatim pane tails from a real oh-my-pi
// (`omp`) session (July 2026 UI): a live turn draws a Braille spinner line
// ("⠧ <task> ⟨esc⟩") above the persistent footer (model · context% · $cost);
// tool results render in │-bordered boxes. omp's own subprocess output (e.g. an
// AttributeError in a tool-result box) is content it is handling, not a pane
// error.

describe("ompAdapter.detect", () => {
  // Active capture 1 — transition to working.
  const activeOmpPane = [
    "│ 'location_fidelity': 100.0, 'false_positive_count': 0, 'duplicate_occurrence_count': 0, 'field_error_counts': {}}) │",
    "│ ⟨Timeout: 300s⟩                                                                                                    │",
    "╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯",
    "",
    " ⠧ Reading airline evaluation result ⟨esc⟩",
    "",
    "╭──     GPT-5.6-Sol · 󰪣 high   ~/code/personal-assistant   master *1   39.3%/272K 󰁨  $350.89 (sub) ──────────────────╮",
    "╰─                                                                                                                  ─╯"
  ].join("\n");

  // Active capture 2 — a tool-result box carries an AttributeError from omp's own
  // subprocess while the live spinner is still ticking. Must read active, and the
  // decision must NOT treat that box error as a pane error.
  const activeOmpPaneWithErrorBox = [
    "│ AttributeError: 'EvaluationResult' object has no attribute 'score'                                                 │",
    "│ ⟨Timeout: 300s⟩                                                                                                    │",
    "╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯",
    "",
    " ⠏ Evaluating recovered airline response ⟨esc⟩",
    "",
    "╭──     GPT-5.6-Sol · 󰪣 high   ~/code/personal-assistant   master *1   39.2%/272K 󰁨  $350.79 (sub) ──────────────────╮",
    "╰─                                                                                                                  ─╯"
  ].join("\n");

  // Synthetic AT-REST pane. NOTE: a real at-rest omp capture is not yet available
  // (a watcher is collecting one). This pins the current approximation — footer
  // chrome present AND no live spinner => prompt, not active. Replace/augment with
  // the verbatim at-rest capture once it lands.
  const atRestOmpPane = [
    "│ Committed the airline evaluation fix.                                                                              │",
    "╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯",
    "",
    "╭──     GPT-5.6-Sol · 󰪣 high   ~/code/personal-assistant   master *1   39.1%/272K 󰁨  $351.02 (sub) ──────────────────╮",
    "╰─                                                                                                                  ─╯"
  ].join("\n");

  it("reads active capture 1 (Braille spinner + ⟨esc⟩) as an active turn with the task text", () => {
    const signals = ompAdapter.detect(activeOmpPane);
    expect(signals.active).toBe(true);
    expect(signals.prompt).toBe(false);
    expect(signals.activityText).toBe("Reading airline evaluation result");
  });

  it("reads active capture 2 (error box present, live spinner) as an active turn", () => {
    const signals = ompAdapter.detect(activeOmpPaneWithErrorBox);
    expect(signals.active).toBe(true);
    expect(signals.prompt).toBe(false);
    expect(signals.activityText).toBe("Evaluating recovered airline response");
  });

  it("reads a footer-only pane (no live spinner) as an at-rest prompt, not an active turn", () => {
    // Marked APPROXIMATION — awaiting the real at-rest fixture (see omp.ts).
    const signals = ompAdapter.detect(atRestOmpPane);
    expect(signals.prompt).toBe(true);
    expect(signals.active).toBe(false);
    expect(signals.activityText).toBeUndefined();
  });
});
