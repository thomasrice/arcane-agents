import { describe, expect, it } from "vitest";
import { codexAdapter } from "./codex";

describe("codexAdapter.detect", () => {
  it("detects approval prompts from Codex terminal output", () => {
    const output = `
      Would you like to run the following command?
      Permission rule: Yes, just this once
      Yes, and don't ask again for this command in this session
      No, continue without running it
    `;

    const signals = codexAdapter.detect(output);
    expect(signals.prompt).toBe(true);
    expect(signals.active).toBe(false);
  });

  it("detects active Codex turns from interrupt hints", () => {
    const output = `
      Searching repository
      esc to interrupt
    `;

    const signals = codexAdapter.detect(output);
    expect(signals.prompt).toBe(false);
    expect(signals.active).toBe(true);
  });

  it("maps Codex approval status lines to waiting text", () => {
    expect(codexAdapter.detect("Status: Waiting on approval").activityText).toBe("Waiting for approval");
  });

  it("maps Codex interrupt hints to responding text", () => {
    expect(codexAdapter.detect("Scanning files\nesc to interrupt").activityText).toBe("Responding");
  });

  // Live pane text captured from the current Codex CLI (the false-working bug).
  // The footer/prompt glyphs drifted from the older "▌ Send a message" UI, so
  // these pin the shapes the detector must recognise.
  const activeCodexPane = [
    "• Working (4m 10s • esc to interrupt)",
    "",
    "",
    "› Run /review on my current changes",
    "",
    "  gpt-5.6-terra medium fast · ~/code/personal-assistant · weekly 93% left · Main [default]"
  ].join("\n");

  const finishedCodexPane = [
    "• Ran agent-browser --session s1 snapshot",
    "  └ ok",
    "• Ran git status",
    "  └ nothing to commit",
    "",
    "› Run /review on my current changes",
    "",
    "  gpt-5.6-terra medium fast · ~/code/personal-assistant · weekly 93% left · Main [default]"
  ].join("\n");

  // Captured from codex-min v0.144.6 after the model ended its turn with a
  // direct question and returned to the ordinary input box.
  const questionCodexPane = [
    '› Ask me exactly "Which colour do you choose: red or blue?" and wait for my answer.',
    "",
    "• Which colour do you choose: red or blue?",
    "",
    "› Find and fix a bug in @filename",
    "",
    "  gpt-5.6-sol low · ~/code/personal-assistant · weekly 98% left"
  ].join("\n");

  it("reads the current Codex active pane as an active turn", () => {
    expect(codexAdapter.detect(activeCodexPane).active).toBe(true);
  });

  it("reads the current Codex finished pane as an at-rest prompt, not an active turn", () => {
    const signals = codexAdapter.detect(finishedCodexPane);
    expect(signals.prompt).toBe(true);
    expect(signals.active).toBe(false);
  });

  it("detects a completed Codex response ending in a question as waiting for input", () => {
    const signals = codexAdapter.detect(questionCodexPane);
    expect(signals.prompt).toBe(true);
    expect(signals.active).toBe(false);
    expect(signals.awaitingInput).toBe(true);
    expect(signals.awaitingApproval).toBe(false);
    expect(signals.activityText).toBe("Waiting for input");
  });

  it("does not retain an earlier Codex question after the user answers it", () => {
    const signals = codexAdapter.detect(
      [
        '› Ask me "Which colour?"',
        "",
        "• Which colour?",
        "",
        "› Red",
        "",
        "• You chose red.",
        "",
        "› Find and fix a bug in @filename",
        "",
        "  gpt-5.6-sol low · ~/code/personal-assistant · weekly 98% left"
      ].join("\n")
    );

    expect(signals.awaitingInput).toBe(false);
  });

  it("does not treat an ordinary at-rest input prompt as waiting for a response", () => {
    const signals = codexAdapter.detect(finishedCodexPane);
    expect(signals.awaitingInput).toBe(false);
    expect(signals.awaitingApproval).toBe(false);
  });
});
