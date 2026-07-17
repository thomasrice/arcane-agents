import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyParsedTranscriptRecords,
  createTranscriptState,
  normalizeToolName,
  resetTranscriptState
} from "./accumulator";
import { extractTranscriptRecords } from "./parser";
import { buildSnapshot } from "./snapshot";
import type { ClaudeTranscriptState } from "./types";

// Golden safety-net for the parser + accumulator lifecycle. These tests pin the
// CURRENT observable behaviour (active vs finished) so a Phase 2 refactor can be
// validated against it. Prose/status-text strings are deliberately NOT asserted.

const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);

function line(value: unknown): string {
  return JSON.stringify(value);
}

function assistant(content: unknown[]): string {
  return line({ type: "assistant", message: { content } });
}

function toolUse(id: string, name: string, input: Record<string, unknown> = {}): unknown {
  return { type: "tool_use", id, name, input };
}

function textBlock(value: string): unknown {
  return { type: "text", text: value };
}

function userToolResults(...toolUseIds: string[]): string {
  return line({
    type: "user",
    message: { content: toolUseIds.map((id) => ({ type: "tool_result", tool_use_id: id })) }
  });
}

function userText(value: string): string {
  return line({ type: "user", message: { content: [{ type: "text", text: value }] } });
}

function userStringContent(value: string): string {
  return line({ type: "user", message: { content: value } });
}

function systemTurnDuration(): string {
  return line({ type: "system", subtype: "turn_duration" });
}

function bashProgress(parentToolUseID: string): string {
  return line({ type: "progress", parentToolUseID, data: { type: "bash_progress" } });
}

function subagentAssistantProgress(parentToolUseID: string, blocks: unknown[]): string {
  return line({
    type: "progress",
    parentToolUseID,
    data: { type: "agent_progress", message: { type: "assistant", message: { content: blocks } } }
  });
}

function subagentUserProgress(parentToolUseID: string, toolUseIds: string[]): string {
  return line({
    type: "progress",
    parentToolUseID,
    data: {
      type: "agent_progress",
      message: {
        type: "user",
        message: { content: toolUseIds.map((id) => ({ type: "tool_result", tool_use_id: id })) }
      }
    }
  });
}

function apply(state: ClaudeTranscriptState, lines: string[]): void {
  applyParsedTranscriptRecords(state, extractTranscriptRecords(lines));
}

describe("extractTranscriptRecords", () => {
  it("keeps only the four known record types and skips junk/unknown lines", () => {
    const lines = [
      "",
      "   ",
      "not json at all",
      "[1, 2, 3]",
      '"just a string"',
      "42",
      line({ noTypeField: true }),
      line({ type: "summary" }),
      assistant([textBlock("hi")]),
      userText("hello"),
      systemTurnDuration(),
      bashProgress("p1")
    ];

    const records = extractTranscriptRecords(lines);

    expect(records.map((record) => record.type)).toEqual(["assistant", "user", "system", "progress"]);
  });
});

describe("accumulator lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks an assistant tool_use as an active tool and reports working", () => {
    const state = createTranscriptState();

    apply(state, [assistant([toolUse("t1", "Read", { file_path: "/repo/foo.ts" })])]);

    expect(state.activeTools.size).toBe(1);
    expect(state.waiting).toBe(false);
    expect(state.busyUntilMs).toBeGreaterThan(T0);

    const snapshot = buildSnapshot(state, T0);
    expect(snapshot?.status).toBe("working");
    expect(snapshot?.activityTool).toBe("read");
    expect(snapshot?.activityPath).toBe("/repo/foo.ts");
  });

  it("ends a tool on the matching user tool_result and falls to idle after the busy window", () => {
    const state = createTranscriptState();
    apply(state, [assistant([toolUse("t1", "Bash", { command: "npm test" })])]);
    expect(state.activeTools.size).toBe(1);

    vi.setSystemTime(T0 + 1_000);
    apply(state, [userToolResults("t1")]);

    expect(state.activeTools.size).toBe(0);
    // Immediately after the result the busy grace window is still open -> working.
    expect(buildSnapshot(state, state.lastEventAtMs)?.status).toBe("working");
    // The window boundary is inclusive.
    expect(buildSnapshot(state, state.busyUntilMs)?.status).toBe("working");
    // One millisecond past the window, with no active tools -> idle.
    expect(buildSnapshot(state, state.busyUntilMs + 1)?.status).toBe("idle");
  });

  it("tracks multiple concurrent tools and only clears each on its own result", () => {
    const state = createTranscriptState();
    apply(state, [
      assistant([toolUse("t1", "Read", { file_path: "/a.ts" }), toolUse("t2", "Bash", { command: "ls" })])
    ]);
    expect(state.activeTools.size).toBe(2);

    vi.setSystemTime(T0 + 500);
    apply(state, [userToolResults("t1")]);
    expect(state.activeTools.size).toBe(1);
    expect(state.activeTools.has("t2")).toBe(true);
    // A second tool is still running -> still working.
    expect(buildSnapshot(state, T0 + 500)?.status).toBe("working");

    vi.setSystemTime(T0 + 1_000);
    apply(state, [userToolResults("t2")]);
    expect(state.activeTools.size).toBe(0);
    expect(buildSnapshot(state, state.busyUntilMs + 1)?.status).toBe("idle");
  });

  it("keeps working through the busy window after a text-only assistant message", () => {
    const state = createTranscriptState();

    apply(state, [assistant([textBlock("Here is the answer.")])]);

    expect(state.activeTools.size).toBe(0);
    expect(state.waiting).toBe(false);
    expect(buildSnapshot(state, T0)?.status).toBe("working");
    expect(buildSnapshot(state, state.busyUntilMs)?.status).toBe("working");
    expect(buildSnapshot(state, state.busyUntilMs + 1)?.status).toBe("idle");
  });

  it("treats a turn_duration system record as turn end: clears tools and goes idle", () => {
    const state = createTranscriptState();
    apply(state, [assistant([toolUse("t1", "Bash", { command: "sleep 30" })])]);
    expect(buildSnapshot(state, T0)?.status).toBe("working");

    vi.setSystemTime(T0 + 1_000);
    apply(state, [systemTurnDuration()]);

    expect(state.activeTools.size).toBe(0);
    expect(state.waiting).toBe(true);
    expect(state.busyUntilMs).toBe(0);
    // Even at the same instant, and with the previous tool gone, the worker is finished.
    const snapshot = buildSnapshot(state, T0 + 1_000);
    expect(snapshot?.status).toBe("idle");
    expect(snapshot?.activityText).toBeUndefined();
    expect(snapshot?.activityTool).toBeUndefined();
  });

  it("clears stale active tools when the user sends a new text prompt (array content)", () => {
    const state = createTranscriptState();
    apply(state, [assistant([toolUse("t1", "Read", { file_path: "/a.ts" })])]);
    expect(state.activeTools.size).toBe(1);

    vi.setSystemTime(T0 + 1_000);
    apply(state, [userText("please also handle X")]);

    expect(state.activeTools.size).toBe(0);
    expect(state.waiting).toBe(false);
    expect(buildSnapshot(state, T0 + 1_000)?.status).toBe("working");
  });

  it("treats a plain-string user message as a new prompt and clears tools", () => {
    const state = createTranscriptState();
    apply(state, [assistant([toolUse("t1", "Read", { file_path: "/a.ts" })])]);

    vi.setSystemTime(T0 + 1_000);
    apply(state, [userStringContent("do the thing")]);

    expect(state.activeTools.size).toBe(0);
    expect(buildSnapshot(state, T0 + 1_000)?.status).toBe("working");
  });

  it("tracks a subagent (Task) tool lifecycle through progress records", () => {
    const state = createTranscriptState();
    apply(state, [assistant([toolUse("task1", "Task", { description: "investigate the bug" })])]);
    expect(state.activeTools.size).toBe(1);
    expect(normalizeToolName(state.activeTools.get("task1")?.toolName ?? "")).toBe("task");

    // The subagent starts an inner tool.
    vi.setSystemTime(T0 + 500);
    apply(state, [subagentAssistantProgress("task1", [toolUse("sub1", "Grep", {})])]);
    expect(state.activeSubagentTools.get("task1")?.size).toBe(1);
    expect(buildSnapshot(state, T0 + 500)?.status).toBe("working");

    // The subagent's inner tool completes: its sub-map empties and is removed,
    // but the parent Task is still running.
    vi.setSystemTime(T0 + 800);
    apply(state, [subagentUserProgress("task1", ["sub1"])]);
    expect(state.activeSubagentTools.get("task1")).toBeUndefined();
    expect(state.activeTools.has("task1")).toBe(true);

    // The parent Task result clears both the parent and any subagent bookkeeping.
    vi.setSystemTime(T0 + 1_200);
    apply(state, [userToolResults("task1")]);
    expect(state.activeTools.size).toBe(0);
    expect(state.activeSubagentTools.size).toBe(0);
  });

  it("refreshes the busy window and progress time when bash_progress arrives for an active bash tool", () => {
    const state = createTranscriptState();
    apply(state, [assistant([toolUse("b1", "Bash", { command: "long-running" })])]);
    const firstProgressAt = state.activeTools.get("b1")?.lastProgressAtMs ?? 0;
    const firstBusyUntil = state.busyUntilMs;

    vi.setSystemTime(T0 + 3_000);
    apply(state, [bashProgress("b1")]);

    expect(state.activeTools.get("b1")?.lastProgressAtMs).toBeGreaterThan(firstProgressAt);
    expect(state.busyUntilMs).toBeGreaterThan(firstBusyUntil);
  });

  it("ignores a bash_progress record for an unknown parent tool", () => {
    const state = createTranscriptState();

    apply(state, [bashProgress("does-not-exist")]);

    expect(state.activeTools.size).toBe(0);
    // The record was still parsed, so a snapshot exists (idle, not undefined).
    expect(state.seenTranscriptRecord).toBe(true);
    expect(buildSnapshot(state, T0)?.status).toBe("idle");
  });

  it("marks seenTranscriptRecord for any parsed record, even a no-op progress record", () => {
    const state = createTranscriptState();
    expect(buildSnapshot(state, T0)).toBeUndefined();

    apply(state, [line({ type: "progress" })]);

    expect(state.seenTranscriptRecord).toBe(true);
    expect(buildSnapshot(state, T0)).toBeDefined();
    expect(buildSnapshot(state, T0)?.status).toBe("idle");
  });

  it("resetTranscriptState clears activity, tools and buffers but not the resolved path", () => {
    const state = createTranscriptState();
    apply(state, [assistant([toolUse("t1", "Read", { file_path: "/a.ts" })])]);
    state.transcriptPath = "/some/transcript.jsonl";
    state.lineBuffer = "partial";
    state.fileOffset = 123;
    state.initialized = true;

    resetTranscriptState(state);

    expect(state.activeTools.size).toBe(0);
    expect(state.activeSubagentTools.size).toBe(0);
    expect(state.lineBuffer).toBe("");
    expect(state.fileOffset).toBe(0);
    expect(state.initialized).toBe(false);
    expect(state.seenTranscriptRecord).toBe(false);
    expect(state.busyUntilMs).toBe(0);
    expect(state.waiting).toBe(false);
    // The path is intentionally preserved across a reset.
    expect(state.transcriptPath).toBe("/some/transcript.jsonl");
  });
});
