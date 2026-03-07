import { describe, expect, it } from "vitest";
import { extractClaudeActiveTask, hasClaudeLiveProgressSignal, hasClaudePromptSignal } from "./claudeSignals";

describe("claudeSignals", () => {
  it("stops treating progress lines as active once the Claude prompt returns", () => {
    const output = [
      "• Reviewing the final patch",
      "✻ Churned for 1m 42s",
      "",
      "❯",
      "  -- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle)"
    ].join("\n");

    expect(hasClaudePromptSignal(output)).toBe(true);
    expect(hasClaudeLiveProgressSignal(output)).toBe(false);
    expect(extractClaudeActiveTask(output)).toBeUndefined();
  });

  it("keeps reporting live progress when Claude is still actively working", () => {
    const output = ["✻ Churned for 12s", "", "Thinking through the next change"].join("\n");

    expect(hasClaudePromptSignal(output)).toBe(false);
    expect(hasClaudeLiveProgressSignal(output)).toBe(true);
  });
});
