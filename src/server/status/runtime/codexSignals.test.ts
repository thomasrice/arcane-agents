import { describe, expect, it } from "vitest";
import { extractRuntimeActivityText } from "./activityTextExtractors";
import { detectCodexSignals } from "./codexSignals";

describe("detectCodexSignals", () => {
  it("detects approval prompts from Codex terminal output", () => {
    const output = `
      Would you like to run the following command?
      Permission rule: Yes, just this once
      Yes, and don't ask again for this command in this session
      No, continue without running it
    `;

    expect(detectCodexSignals(output)).toEqual({
      prompt: true,
      active: false
    });
  });

  it("detects active Codex turns from interrupt hints", () => {
    const output = `
      Searching repository
      esc to interrupt
    `;

    expect(detectCodexSignals(output)).toEqual({
      prompt: false,
      active: true
    });
  });
});

describe("extractRuntimeActivityText", () => {
  it("maps Codex approval status lines to waiting text", () => {
    const output = "Status: Waiting on approval";

    expect(
      extractRuntimeActivityText(output, {
        isClaude: false,
        isOpenCode: false,
        isCodex: true
      })
    ).toBe("Waiting for approval");
  });

  it("maps Codex interrupt hints to responding text", () => {
    const output = "Scanning files\nesc to interrupt";

    expect(
      extractRuntimeActivityText(output, {
        isClaude: false,
        isOpenCode: false,
        isCodex: true
      })
    ).toBe("Responding");
  });
});
