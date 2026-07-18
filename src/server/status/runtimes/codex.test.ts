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

  it("reads the current Codex active pane as an active turn", () => {
    expect(codexAdapter.detect(activeCodexPane).active).toBe(true);
  });

  it("reads the current Codex finished pane as an at-rest prompt, not an active turn", () => {
    const signals = codexAdapter.detect(finishedCodexPane);
    expect(signals.prompt).toBe(true);
    expect(signals.active).toBe(false);
  });

  it("does not treat the at-rest input prompt as an approval request", () => {
    expect(codexAdapter.detect(finishedCodexPane).awaitingApproval).toBe(false);
  });
});
