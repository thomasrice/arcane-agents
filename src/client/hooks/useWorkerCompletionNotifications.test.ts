import { describe, expect, it } from "vitest";
import type { Worker, WorkerStatus } from "../../shared/types";
import { selectPendingCompletionWorkerIds } from "./useWorkerCompletionNotifications";

function worker(
  id: string,
  status: WorkerStatus,
  silenced = false,
  completion: Pick<Worker, "completedAt" | "completionReviewedAt"> = {}
): Worker {
  return {
    id,
    name: id,
    projectId: "project",
    projectPath: "/project",
    runtimeId: "shell",
    runtimeLabel: "Shell",
    command: ["bash"],
    status,
    avatarType: "wizard",
    movementMode: "hold",
    silenced,
    position: { x: 0, y: 0 },
    tmuxRef: { session: "arcane-agents", window: id, pane: "%1" },
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...completion
  };
}

describe("selectPendingCompletionWorkerIds", () => {
  const finished = { completedAt: "2026-07-01T02:00:00.000Z" };

  it("includes unreviewed completions but ignores silenced characters", () => {
    const pending = selectPendingCompletionWorkerIds(
      [worker("audible", "idle", false, finished), worker("silent", "idle", true, finished)],
      undefined
    );

    expect(pending).toEqual(["audible"]);
  });

  it("drops a completion once it has been reviewed or its terminal is open", () => {
    const reviewed = worker("reviewed", "idle", false, { ...finished, completionReviewedAt: "2026-07-01T03:00:00.000Z" });
    const open = worker("open", "idle", false, finished);

    expect(selectPendingCompletionWorkerIds([reviewed, open], "open")).toEqual([]);
  });

  it("does not report an idle character that has never completed work", () => {
    expect(selectPendingCompletionWorkerIds([worker("worker-1", "idle")], undefined)).toEqual([]);
  });
});
