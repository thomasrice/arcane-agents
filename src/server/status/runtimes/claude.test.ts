import { describe, expect, it } from "vitest";
import { claudeAdapter } from "./claude";

// Fixtures below marked "captured live" are verbatim pane tails from real
// Claude Code sessions (July 2026 UI): the input box ("❯") and mode footer
// stay on screen WHILE the agent works, the live spinner is a bare label
// ("✢ Wrangling…"), and "for <duration>" spinner lines are completed-segment
// markers left in scrollback.

describe("claudeAdapter.detect", () => {
  it("treats a bare-label spinner above the persistent input box as active (captured live)", () => {
    const output = [
      "✻ Sautéed for 11m 3s",
      "",
      "❯ Run ~/bin/merge from the current Taurient worktree to rebase it and fast-forward merge it into master.",
      "",
      "✢ Wrangling…",
      "  ⎿  Tip: Working with HTML/CSS? Install the frontend-design plugin:",
      "     /plugin install frontend-design@claude-plugins-official",
      "",
      "─────────────────────────",
      "❯ ",
      "─────────────────────────",
      "  thomas@thomasrice.com · Opus 4.8 · personal-assistant(master) · ctx 68% · 5h 84% left (19m) · wk 30% left (90h29m)",
      "  -- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents"
    ].join("\n");

    const signals = claudeAdapter.detect(output);
    expect(signals.active).toBe(true);
    expect(signals.prompt).toBe(true);
  });

  it("treats a waiting-on-subagents spinner as active (captured live)", () => {
    const output = [
      "  run the battery, ship as v1.4.1, and the acceptance test on your live instance will be: next Claude turn",
      "",
      "✻ Waiting for 1 background agent to finish",
      "",
      "─────────────────────────",
      "❯ ",
      "─────────────────────────",
      "  thomas@minotaurcapital.com · Fable 5 · arcane-agents(main) · ctx 53% · 5h 86% left (3h52m) · wk 40% left (126h22m)",
      "  -- INSERT -- ⏵⏵ bypass permissions on · 1 shell · ← for agents"
    ].join("\n");

    const signals = claudeAdapter.detect(output);
    expect(signals.active).toBe(true);
  });

  it("reads a finished pane (completion text, chrome, no spinner) as prompt-only (captured live)", () => {
    const output = [
      "  copies with images — I pulled one back out of R2 to confirm: valid HTML, images inlined as data: URIs,",
      "  stripped (1.9–3.9 MB each). This supersedes the manual Labyrinth mirror.",
      "",
      "  - Global \"Company Publications\" feed (/fh/company-publications) — a Data-nav tab beside Acta.",
      "",
      "─────────────────────────",
      "❯ ",
      "─────────────────────────",
      "  thomas@thomasrice.com · Opus 4.8 · personal-assistant(master) · ctx 68% · 5h 84% left (19m) · wk 30% left (90h29m)",
      "  -- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents"
    ].join("\n");

    const signals = claudeAdapter.detect(output);
    expect(signals.prompt).toBe(true);
    expect(signals.active).toBe(false);
    expect(signals.activeTask).toBeUndefined();
  });

  it("does not treat completed-segment duration markers or tool bullets as active", () => {
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

  it("keeps thinking-parenthetical spinners active regardless of duration form", () => {
    const output = ["✶ Baking… (12s · thinking)", ""].join("\n");

    const signals = claudeAdapter.detect(output);
    expect(signals.active).toBe(true);
  });

  it("ignores spinner residue above a newer echoed command", () => {
    // A previous turn's spinner line lingering ABOVE the newest "❯ <command>"
    // echo belongs to that finished turn and must not read as live.
    const output = [
      "✢ Wrangling…",
      "",
      "❯ describe the repo layout",
      "",
      "  The repo has three top-level directories: src, assets, and dist.",
      "",
      "❯ "
    ].join("\n");

    const signals = claudeAdapter.detect(output);
    expect(signals.active).toBe(false);
  });
});
