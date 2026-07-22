import { describe, expect, it } from "vitest";
import type { ActivityTool } from "../../../shared/types";
import { createTranscriptState } from "./accumulator";
import { activeToolStaleAfterMs } from "./constants";
import { buildSnapshot } from "./snapshot";
import type { ActiveToolEntry, ClaudeTranscriptState } from "./types";

// Golden safety-net for snapshot derivation: working vs idle vs attention, plus
// the busyUntil and active-tool staleness windows. Windows are probed relative
// to the exported threshold constants and to state values set directly, so the
// tests stay valid if those thresholds are re-tuned by the refactor.

const NOW = 1_000_000_000;

function seenState(): ClaudeTranscriptState {
  const state = createTranscriptState();
  state.seenTranscriptRecord = true;
  return state;
}

function activeTool(
  toolName: string,
  lastProgressAtMs: number,
  opts: { activityTool?: ActivityTool; activityPath?: string } = {}
): ActiveToolEntry {
  return {
    toolName,
    statusText: "busy",
    activityTool: opts.activityTool,
    activityPath: opts.activityPath,
    lastProgressAtMs
  };
}

describe("buildSnapshot", () => {
  it("returns undefined until at least one transcript record has been seen", () => {
    expect(buildSnapshot(createTranscriptState(), NOW)).toBeUndefined();
  });

  it("returns an idle snapshot once a record was seen but nothing is active", () => {
    const state = seenState();
    state.lastEventAtMs = NOW;
    state.busyUntilMs = 0;

    const snapshot = buildSnapshot(state, NOW);
    expect(snapshot).toBeDefined();
    expect(snapshot?.status).toBe("idle");
  });

  it("reports working while a fresh non-exempt tool is active", () => {
    const state = seenState();
    state.lastEventAtMs = NOW;
    state.activeTools.set("b1", activeTool("Bash", NOW, { activityTool: "bash" }));

    const snapshot = buildSnapshot(state, NOW);
    expect(snapshot?.status).toBe("working");
    expect(snapshot?.activityTool).toBe("bash");
  });

  it("counts subagent tools as active work", () => {
    const state = seenState();
    state.lastEventAtMs = NOW;
    const subagentTools = new Map<string, ActiveToolEntry>();
    subagentTools.set("s1", activeTool("Read", NOW, { activityTool: "read" }));
    state.activeSubagentTools.set("task1", subagentTools);

    expect(buildSnapshot(state, NOW)?.status).toBe("working");
  });

  it("uses the most recently active tool to describe the current activity", () => {
    const state = seenState();
    state.lastEventAtMs = NOW;
    state.activeTools.set("older", activeTool("Read", NOW, { activityTool: "read", activityPath: "/old.ts" }));
    state.activeTools.set("newer", activeTool("Edit", NOW + 10, { activityTool: "edit", activityPath: "/new.ts" }));

    const snapshot = buildSnapshot(state, NOW + 20);
    expect(snapshot?.activityTool).toBe("edit");
    expect(snapshot?.activityPath).toBe("/new.ts");
  });

  describe("busy window (no active tools)", () => {
    it("is working within the window and idle just past it", () => {
      const state = seenState();
      state.lastEventAtMs = NOW;
      state.busyUntilMs = NOW + 5_000;

      // Boundary is inclusive (nowMs <= busyUntilMs).
      expect(buildSnapshot(state, NOW + 5_000)?.status).toBe("working");
      expect(buildSnapshot(state, NOW + 5_001)?.status).toBe("idle");
    });

    it("is suppressed to idle when the waiting (turn-end) flag is set, even inside the window", () => {
      const state = seenState();
      state.lastEventAtMs = NOW;
      state.busyUntilMs = NOW + 10_000;
      state.waiting = true;

      // The waiting flag is the finished signal; it wins over an open busy window.
      expect(buildSnapshot(state, NOW)?.status).toBe("idle");
    });
  });

  describe("explicit attention detection", () => {
    it("keeps a long-running Bash tool working while its transcript entry is fresh", () => {
      const state = seenState();
      state.lastEventAtMs = NOW;
      state.activeTools.set("b1", activeTool("Bash", NOW, { activityTool: "bash" }));

      // The transcript cannot distinguish a running tool from a parked
      // permission dialog. Native pane signals own permission detection.
      const snapshot = buildSnapshot(state, NOW + activeToolStaleAfterMs);
      expect(snapshot?.status).toBe("working");
      expect(snapshot?.activityTool).toBe("bash");
    });

    it("reports attention immediately when an AskUserQuestion tool is active", () => {
      const state = seenState();
      state.lastEventAtMs = NOW;
      state.activeTools.set("q1", activeTool("AskUserQuestion", NOW));

      const snapshot = buildSnapshot(state, NOW);
      expect(snapshot?.status).toBe("attention");
      expect(snapshot?.activityTool).toBe("terminal");
    });
  });

  describe("staleness filtering", () => {
    it("drops an active tool once the transcript has been quiet beyond the stale window -> idle", () => {
      const state = seenState();
      state.lastEventAtMs = NOW;
      state.busyUntilMs = 0;
      state.activeTools.set("task1", activeTool("Task", NOW, { activityTool: "task" }));

      // At the stale boundary (inclusive) the tool is still counted -> working.
      expect(buildSnapshot(state, NOW + activeToolStaleAfterMs)?.status).toBe("working");

      // Just past it, the stale tool is dropped and there is no busy window -> idle.
      expect(buildSnapshot(state, NOW + activeToolStaleAfterMs + 1)?.status).toBe("idle");
    });

    it("drops even the freshest-possible tool once the transcript is quiet beyond the stale window", () => {
      // Contract (now explicit in listFreshActiveTools): once the transcript has
      // been quiet beyond the stale window, ALL active tools are dropped — no tool
      // can be fresher than the last transcript event, so a single transcript-quiet
      // check is sufficient. This exercises it with the freshest reachable state (a
      // tool whose progress equals the last event); it still reads idle.
      const state = seenState();
      const lastEvent = NOW;
      state.lastEventAtMs = lastEvent;
      state.busyUntilMs = 0;
      state.activeTools.set("stale", activeTool("Task", lastEvent - 10_000, { activityTool: "task" }));
      state.activeTools.set("freshest", activeTool("Task", lastEvent, { activityTool: "task" }));

      const evalAt = lastEvent + activeToolStaleAfterMs + 1;
      expect(buildSnapshot(state, evalAt)?.status).toBe("idle");
    });
  });
});
