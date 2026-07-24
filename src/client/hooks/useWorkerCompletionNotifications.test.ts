import { describe, expect, it } from "vitest";
import type { Worker, WorkerStatus } from "../../shared/types";
import { reconcilePendingCompletionWorkerIds } from "./useWorkerCompletionNotifications";

function worker(id: string, status: WorkerStatus, silenced = false): Worker {
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
    updatedAt: "2026-07-01T00:00:00.000Z"
  };
}

describe("reconcilePendingCompletionWorkerIds", () => {
  it("adds audible working-to-idle transitions but ignores silenced completions", () => {
    const previous = new Map<string, WorkerStatus>([
      ["audible", "working"],
      ["silent", "working"]
    ]);

    const pending = reconcilePendingCompletionWorkerIds(
      [],
      [worker("audible", "idle"), worker("silent", "idle", true)],
      previous,
      undefined
    );

    expect(pending).toEqual(["audible"]);
  });

  it("removes an already-pending completion as soon as its character is silenced", () => {
    const pending = reconcilePendingCompletionWorkerIds(
      ["silent"],
      [worker("silent", "idle", true)],
      new Map([["silent", "idle"]]),
      undefined
    );

    expect(pending).toEqual([]);
  });

  it("does not create a stale completion when an idle character is unsilenced", () => {
    const pending = reconcilePendingCompletionWorkerIds(
      [],
      [worker("worker-1", "idle")],
      new Map([["worker-1", "idle"]]),
      undefined
    );

    expect(pending).toEqual([]);
  });
});
