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
});
