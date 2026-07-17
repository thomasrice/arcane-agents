import { describe, expect, it } from "vitest";
import { claudeAdapter } from "./claude";

describe("claudeAdapter.detect", () => {
  it("stops treating progress lines as active once the Claude prompt returns", () => {
    const output = [
      "• Reviewing the final patch",
      "✻ Churned for 1m 42s",
      "",
      "❯",
      "  -- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle)"
    ].join("\n");

    const signals = claudeAdapter.detect(output);
    expect(signals.prompt).toBe(true);
    expect(signals.active).toBe(false);
    expect(signals.activeTask).toBeUndefined();
  });

  it("keeps reporting live progress when Claude is still actively working", () => {
    const output = ["✻ Churned for 12s", "", "Thinking through the next change"].join("\n");

    const signals = claudeAdapter.detect(output);
    expect(signals.prompt).toBe(false);
    expect(signals.active).toBe(true);
  });
});
