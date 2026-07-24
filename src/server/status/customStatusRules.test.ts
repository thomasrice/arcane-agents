import { describe, expect, it } from "vitest";
import type { StatusRule, Worker } from "../../shared/types";
import { compileStatusRules, lastNonEmptyLine, matchCustomStatusRule } from "./customStatusRules";

function worker(overrides: Partial<Worker> = {}): Worker {
  return {
    id: "worker-1",
    name: "worker-1",
    displayName: "Mithril",
    projectId: "home",
    projectPath: "/home/thomas",
    runtimeId: "shell",
    runtimeLabel: "Shell",
    command: ["bash"],
    status: "working",
    avatarType: "wizard",
    movementMode: "hold",
    silenced: false,
    position: { x: 0, y: 0 },
    tmuxRef: { session: "arcane-agents", window: "worker-1", pane: "0" },
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
    ...overrides
  };
}

function match(rules: StatusRule[], overrides: { worker?: Worker; currentCommand?: string; output?: string } = {}) {
  return matchCustomStatusRule(compileStatusRules(rules), {
    worker: overrides.worker ?? worker(),
    currentCommand: overrides.currentCommand ?? "python3",
    output: overrides.output ?? "No available quests for Mithril; checking again in 42s."
  });
}

describe("lastNonEmptyLine", () => {
  it("returns the trimmed current line past blank trailing rows", () => {
    expect(lastNonEmptyLine("historical output\n  current screen state  \r\n\n  \n")).toBe("current screen state");
  });

  it("returns undefined when the screen has no content", () => {
    expect(lastNonEmptyLine("\n  \r\n")).toBeUndefined();
  });
});

describe("custom status rules", () => {
  const waitingRule: StatusRule = {
    id: "quest-board-pollers-waiting",
    match: {
      projectId: "home",
      runtimeId: "shell",
      command: "^python3$",
      lastLine: "^No (?:available|AI review) quests for [^;]+; checking again in [0-9]+s\\.$"
    },
    set: { status: "idle" }
  };

  it.each([
    "No available quests for Goldak; checking again in 47s.",
    "No AI review quests for Spark; checking again in 30s.",
    "No available quests for Mithril; checking again in 52s."
  ])("matches Quest Board waiting output without constraining the agent name", (output) => {
    expect(match([waitingRule], { output })).toEqual({
      ruleId: "quest-board-pollers-waiting",
      outcome: { status: "idle" }
    });
  });

  it.each([
    "Goldak running QB-123: Fix detection",
    "Spark reviewing QB-123: Review detection",
    "ordinary Python output"
  ])("does not match non-waiting output: %s", (output) => {
    expect(match([waitingRule], { output })).toBeUndefined();
  });

  it("requires every configured matcher", () => {
    expect(match([waitingRule], { currentCommand: "node" })).toBeUndefined();
    expect(match([waitingRule], { worker: worker({ projectId: "other" }) })).toBeUndefined();
    expect(match([waitingRule], { worker: worker({ runtimeId: "claude" }) })).toBeUndefined();
  });

  it("supports display-name patterns when a user explicitly configures one", () => {
    const namedRule: StatusRule = {
      id: "named",
      match: { displayName: "^Mithril$" },
      set: { status: "attention", activityText: "Review requested", activityTool: "terminal" }
    };

    expect(match([namedRule])?.ruleId).toBe("named");
    expect(match([namedRule], { worker: worker({ displayName: "Goldak" }) })).toBeUndefined();
  });

  it("uses the first matching rule", () => {
    const rules: StatusRule[] = [
      { id: "first", match: { command: "^python3$" }, set: { status: "idle" } },
      { id: "second", match: { command: "^python3$" }, set: { status: "error" } }
    ];

    expect(match(rules)?.ruleId).toBe("first");
  });
});
