import { describe, expect, it } from "vitest";
import type { Worker } from "../../shared/types";
import { WorkerVisualStateTracker } from "./workerVisualState";

function worker(silenced: boolean): Worker {
  return {
    id: "worker-1",
    name: "worker-1",
    projectId: "project",
    projectPath: "/project",
    runtimeId: "claude",
    runtimeLabel: "Claude",
    command: ["claude"],
    status: "working",
    activityText: "Editing src/client/App.tsx",
    activityTool: "edit",
    avatarType: "wizard",
    movementMode: "hold",
    silenced,
    position: { x: 0, y: 0 },
    tmuxRef: { session: "arcane-agents", window: "worker-1", pane: "%1" },
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z"
  };
}

describe("WorkerVisualStateTracker activity overlays", () => {
  it("removes the automatic activity badge when a working character is silenced", () => {
    const tracker = new WorkerVisualStateTracker();
    const activeWorkerIds = new Set(["worker-1"]);

    expect(tracker.updateActivityOverlays([worker(false)], 1_000, activeWorkerIds)).toEqual({
      "worker-1": { text: "Editing src/client/App.tsx", shimmerPhase: undefined }
    });
    expect(tracker.updateActivityOverlays([worker(true)], 1_100, activeWorkerIds)).toEqual({});
  });
});
