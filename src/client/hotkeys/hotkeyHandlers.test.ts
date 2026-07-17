import { describe, expect, it, vi } from "vitest";
import type { Worker } from "../../shared/types";
import type { AppHotkeyContext } from "./hotkeyContext";
import { handleNavigationHotkeys, handleSystemHotkeys } from "./hotkeyHandlers";

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

// Mirrors useSelectionModel's applySelection: member focus only sticks once the
// selection is a group.
function applySelectionInto(getContext: () => AppHotkeyContext) {
  return (workerIds: string[], options?: { focusWorkerId?: string }) => {
    const context = getContext();
    context.selectedWorkerIds = workerIds;
    context.focusedSelectedWorkerId =
      options?.focusWorkerId && workerIds.length > 1 ? options.focusWorkerId : undefined;
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
    const applySelection = vi.fn(applySelectionInto(() => context));
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
      [["worker-6"], { center: true, focusWorkerId: "worker-6" }],
      [["worker-8"], { center: true, focusWorkerId: "worker-8" }],
      [["worker-5-a", "worker-5-b"], { center: true, focusWorkerId: "worker-5-a" }]
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
    const applySelection = vi.fn(applySelectionInto(() => context));
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
      [["worker-8"], { center: true, focusWorkerId: "worker-8" }],
      [["worker-6"], { center: true, focusWorkerId: "worker-6" }],
      [["worker-5-a", "worker-5-b"], { center: true, focusWorkerId: "worker-5-a" }]
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

    expect(applySelection).toHaveBeenCalledWith(["worker-7"], { center: true, focusWorkerId: "worker-7" });
  });

  it("focuses the group member listed first, not the one stored first in the group", () => {
    const applySelection = vi.fn();
    const context = {
      activeWorkers: [worker("worker-a"), worker("worker-z")],
      applySelection,
      controlGroupByDigitRef: { current: { 4: ["worker-z", "worker-a"] } },
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

    expect(applySelection).toHaveBeenCalledWith(["worker-z", "worker-a"], {
      center: true,
      focusWorkerId: "worker-a"
    });
  });

  it("keeps the group page when a group is selected by digit", () => {
    const applySelection = vi.fn();
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
      preventDefault: vi.fn()
    } as unknown as KeyboardEvent;

    handleNavigationHotkeys(event, context);

    expect(applySelection).toHaveBeenCalledWith(["worker-1", "worker-2"], { center: true });
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

    expect(applySelection).toHaveBeenCalledWith(["worker-3"], { center: true, focusWorkerId: "worker-3" });
  });
});

describe("confirm-dialog system hotkeys", () => {
  function confirmContext(overrides: Partial<AppHotkeyContext>): AppHotkeyContext {
    return {
      restartConfirmWorkerIds: [],
      killConfirmWorkerIds: [],
      confirmKillSelection: vi.fn(),
      closeKillConfirm: vi.fn(),
      confirmRestartSelection: vi.fn(),
      closeRestartConfirm: vi.fn(),
      isEditableTarget: () => false,
      isTerminalTarget: () => false,
      ...overrides
    } as unknown as AppHotkeyContext;
  }

  function keydown(overrides: {
    key: string;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    preventDefault: () => void;
  }): KeyboardEvent {
    return {
      key: overrides.key,
      code: "",
      ctrlKey: overrides.ctrlKey ?? false,
      metaKey: overrides.metaKey ?? false,
      altKey: overrides.altKey ?? false,
      shiftKey: overrides.shiftKey ?? false,
      target: null,
      preventDefault: overrides.preventDefault
    } as unknown as KeyboardEvent;
  }

  it("ignores bare modifier keydowns while the kill confirm is open", () => {
    const context = confirmContext({ killConfirmWorkerIds: ["worker-1"] });

    for (const key of ["Shift", "Control", "Alt", "Meta", "CapsLock"]) {
      const preventDefault = vi.fn();
      // Not handled: routing must continue, and the dialog must not react.
      expect(handleSystemHotkeys(keydown({ key, shiftKey: key === "Shift", preventDefault }), context)).toBe(false);
      expect(preventDefault).not.toHaveBeenCalled();
    }

    expect(context.closeKillConfirm).not.toHaveBeenCalled();
    expect(context.confirmKillSelection).not.toHaveBeenCalled();
  });

  it("confirms the kill selection on unmodified Enter", () => {
    const context = confirmContext({ killConfirmWorkerIds: ["worker-1"] });
    const preventDefault = vi.fn();

    expect(handleSystemHotkeys(keydown({ key: "Enter", preventDefault }), context)).toBe(true);
    expect(context.confirmKillSelection).toHaveBeenCalledOnce();
    expect(context.closeKillConfirm).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("dismisses the kill confirm on a non-modifier, non-Enter key", () => {
    const context = confirmContext({ killConfirmWorkerIds: ["worker-1"] });
    const preventDefault = vi.fn();

    expect(handleSystemHotkeys(keydown({ key: "a", preventDefault }), context)).toBe(true);
    expect(context.closeKillConfirm).toHaveBeenCalledOnce();
    expect(context.confirmKillSelection).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("applies the same contract to the restart confirm dialog", () => {
    const shiftContext = confirmContext({ restartConfirmWorkerIds: ["worker-1"] });
    const shiftPreventDefault = vi.fn();
    expect(
      handleSystemHotkeys(keydown({ key: "Shift", shiftKey: true, preventDefault: shiftPreventDefault }), shiftContext)
    ).toBe(false);
    expect(shiftContext.closeRestartConfirm).not.toHaveBeenCalled();
    expect(shiftContext.confirmRestartSelection).not.toHaveBeenCalled();
    expect(shiftPreventDefault).not.toHaveBeenCalled();

    const enterContext = confirmContext({ restartConfirmWorkerIds: ["worker-1"] });
    expect(handleSystemHotkeys(keydown({ key: "Enter", preventDefault: vi.fn() }), enterContext)).toBe(true);
    expect(enterContext.confirmRestartSelection).toHaveBeenCalledOnce();
    expect(enterContext.closeRestartConfirm).not.toHaveBeenCalled();

    const letterContext = confirmContext({ restartConfirmWorkerIds: ["worker-1"] });
    expect(handleSystemHotkeys(keydown({ key: "x", preventDefault: vi.fn() }), letterContext)).toBe(true);
    expect(letterContext.closeRestartConfirm).toHaveBeenCalledOnce();
    expect(letterContext.confirmRestartSelection).not.toHaveBeenCalled();
  });
});
