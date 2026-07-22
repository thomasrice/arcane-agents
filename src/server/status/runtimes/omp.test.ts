import { describe, expect, it } from "vitest";
import { ompAdapter } from "./omp";

// Fixtures marked "captured live" are verbatim pane tails from real oh-my-pi
// (`omp`) sessions (July 2026 UI): a live turn draws a Braille spinner line
// ("⠧ <task> ⟨esc⟩") above persistent prompt chrome; tool results render in
// │-bordered boxes. omp's own subprocess output (e.g. an AttributeError in a
// tool-result box) is content it is handling, not a pane error.

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

  // Captured live at rest from the Kioxia session. Current omp prompt chrome
  // keeps the model/context bar but no longer includes a running dollar cost.
  const atRestOmpPane = [
    "Plan is current and the remaining reachable work is done.",
    "",
    "╭── K3 · max · ~/code/personal-assistant · master *1 · 27.5%/1M · (sub) ──╮",
    "╰─                                                                      ─╯"
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

  it("reads the current cost-free prompt chrome as at rest, not an active turn", () => {
    const signals = ompAdapter.detect(atRestOmpPane);
    expect(signals.prompt).toBe(true);
    expect(signals.active).toBe(false);
    expect(signals.activityText).toBeUndefined();
  });
});
