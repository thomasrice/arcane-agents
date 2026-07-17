import { describe, expect, it, vi } from "vitest";
import type { Worker } from "../../shared/types";
import type { AppHotkeyContext } from "./hotkeyContext";
import { handleNavigationHotkeys } from "./hotkeyHandlers";

function worker(id: string): Worker {
  return {
    id,
    name: id,
    displayName: id,
    projectId: "project",
    projectPath: "/project",
    runtimeId: "shell",
    command: ["bash"],
    runtimeLabel: "Shell",
    status: "idle",
    avatarType: "wizard",
    movementMode: "hold",
    position: { x: 0, y: 0 },
    tmuxRef: { session: "arcane-agents", window: id, pane: "0" },
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
  };
}

describe("control-group navigation hotkeys", () => {
  it("requests map centering for every worker in a selected group", () => {
    const applySelection = vi.fn();
    const preventDefault = vi.fn();
    const context = {
      activeWorkers: [worker("worker-1"), worker("worker-2")],
      applySelection,
      controlGroupByDigitRef: { current: { 2: ["worker-1", "worker-2"] } },
      isEditableTarget: () => false,
      parseControlGroupDigit: () => 2,
      selectedWorkerIds: []
    } as unknown as AppHotkeyContext;
    const event = {
      key: "2",
      code: "Digit2",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      target: null,
      preventDefault
    } as unknown as KeyboardEvent;

    expect(handleNavigationHotkeys(event, context)).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(applySelection).toHaveBeenCalledWith(["worker-1", "worker-2"], { center: true });
  });
});
