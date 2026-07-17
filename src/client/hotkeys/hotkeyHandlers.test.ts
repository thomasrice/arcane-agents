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

  it("cycles sparse numbered groups from a focused member and wraps", () => {
    const preventDefault = vi.fn();
    const context = {
      activeWorkers: [
        worker("worker-5-a"),
        worker("worker-5-b"),
        worker("worker-6"),
        worker("worker-8")
      ],
      controlGroupByDigitRef: {
        current: {
          5: ["worker-5-a", "worker-5-b"],
          6: ["worker-6"],
          8: ["worker-8"]
        }
      },
      focusedSelectedWorkerId: "worker-5-b",
      isEditableTarget: () => false,
      isTerminalTarget: () => false,
      parseControlGroupDigit: () => undefined,
      selectedWorkerIds: ["worker-5-b"]
    } as unknown as AppHotkeyContext;
    const applySelection = vi.fn((workerIds: string[]) => {
      context.selectedWorkerIds = workerIds;
      context.focusedSelectedWorkerId = undefined;
    });
    context.applySelection = applySelection;
    const event = {
      key: "`",
      code: "Backquote",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      target: null,
      preventDefault
    } as unknown as KeyboardEvent;

    handleNavigationHotkeys(event, context);
    handleNavigationHotkeys(event, context);
    handleNavigationHotkeys(event, context);

    expect(applySelection.mock.calls).toEqual([
      [["worker-6"], { center: true }],
      [["worker-8"], { center: true }],
      [["worker-5-a", "worker-5-b"], { center: true }]
    ]);
    expect(preventDefault).toHaveBeenCalledTimes(3);
  });

  it("cycles sparse numbered groups backwards with shift and wraps", () => {
    const preventDefault = vi.fn();
    const context = {
      activeWorkers: [
        worker("worker-5-a"),
        worker("worker-5-b"),
        worker("worker-6"),
        worker("worker-8")
      ],
      controlGroupByDigitRef: {
        current: {
          5: ["worker-5-a", "worker-5-b"],
          6: ["worker-6"],
          8: ["worker-8"]
        }
      },
      focusedSelectedWorkerId: "worker-5-b",
      isEditableTarget: () => false,
      isTerminalTarget: () => false,
      parseControlGroupDigit: () => undefined,
      selectedWorkerIds: ["worker-5-b"]
    } as unknown as AppHotkeyContext;
    const applySelection = vi.fn((workerIds: string[]) => {
      context.selectedWorkerIds = workerIds;
      context.focusedSelectedWorkerId = undefined;
    });
    context.applySelection = applySelection;
    const event = {
      key: "~",
      code: "Backquote",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: true,
      target: null,
      preventDefault
    } as unknown as KeyboardEvent;

    handleNavigationHotkeys(event, context);
    handleNavigationHotkeys(event, context);
    handleNavigationHotkeys(event, context);

    expect(applySelection.mock.calls).toEqual([
      [["worker-8"], { center: true }],
      [["worker-6"], { center: true }],
      [["worker-5-a", "worker-5-b"], { center: true }]
    ]);
    expect(preventDefault).toHaveBeenCalledTimes(3);
  });

  it("starts backwards cycling at the last populated group without a focused selection", () => {
    const applySelection = vi.fn();
    const context = {
      activeWorkers: [worker("worker-3"), worker("worker-7")],
      applySelection,
      controlGroupByDigitRef: {
        current: {
          3: ["worker-3"],
          7: ["worker-7"]
        }
      },
      focusedSelectedWorkerId: undefined,
      isEditableTarget: () => false,
      isTerminalTarget: () => false,
      parseControlGroupDigit: () => undefined,
      selectedWorkerIds: []
    } as unknown as AppHotkeyContext;
    const event = {
      key: "~",
      code: "Backquote",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: true,
      target: null,
      preventDefault: vi.fn()
    } as unknown as KeyboardEvent;

    handleNavigationHotkeys(event, context);

    expect(applySelection).toHaveBeenCalledWith(["worker-7"], { center: true });
  });

  it("starts cycling at the first populated group without a focused selection", () => {
    const applySelection = vi.fn();
    const context = {
      activeWorkers: [worker("worker-3"), worker("worker-7")],
      applySelection,
      controlGroupByDigitRef: {
        current: {
          3: ["worker-3"],
          7: ["worker-7"]
        }
      },
      focusedSelectedWorkerId: undefined,
      isEditableTarget: () => false,
      isTerminalTarget: () => false,
      parseControlGroupDigit: () => undefined,
      selectedWorkerIds: []
    } as unknown as AppHotkeyContext;
    const event = {
      key: "`",
      code: "Backquote",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      target: null,
      preventDefault: vi.fn()
    } as unknown as KeyboardEvent;

    handleNavigationHotkeys(event, context);

    expect(applySelection).toHaveBeenCalledWith(["worker-3"], { center: true });
  });
});
