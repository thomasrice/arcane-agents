import { describe, expect, it, vi } from "vitest";
import type { Worker } from "../../shared/types";
import { getHotkeyReference, hotkeyBindings, runHotkeyRegistry, type HotkeyContext } from "./registry";

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
    updatedAt: "2026-07-17T00:00:00.000Z"
  };
}

// A fully-populated context with harmless defaults. The registry walk evaluates every
// eligible binding's matcher until one claims the event, so partial contexts would trip
// over undefined callbacks; tests override only the fields they exercise.
function baseContext(overrides: Partial<HotkeyContext> = {}): HotkeyContext {
  return {
    activeWorkers: [],
    selectedWorkerId: undefined,
    selectedWorkerIds: [],
    selectedWorkers: [],
    focusedSelectedWorkerId: undefined,
    inSelectedGroupView: false,
    rosterEntries: [],
    rosterActiveIndex: 0,
    selectedGroupActiveIndex: 0,
    firstSummonEntryIndex: undefined,
    controlGroups: {},
    pendingConfirm: null,
    openDialog: null,
    shortcutHotkeyBindings: [],
    applySelection: vi.fn(),
    cycleSelection: vi.fn(),
    cycleIdleSelection: vi.fn(),
    cycleSelectedGroupFocus: vi.fn(),
    setControlGroups: vi.fn(),
    setRosterActiveIndex: vi.fn(),
    setSelectedGroupActiveIndex: vi.fn(),
    setFocusedSelectedWorkerId: vi.fn(),
    requestTerminalFocus: vi.fn(),
    clearConfirm: vi.fn(),
    confirmPending: vi.fn(),
    closeRename: vi.fn(),
    setBatchSpawnDialogOpen: vi.fn(),
    setShortcutsOverlayOpen: vi.fn(),
    setPaletteOpen: vi.fn(),
    setSpawnDialogOpen: vi.fn(),
    nudgeMapColumnRatio: vi.fn(),
    resetMapColumnRatio: vi.fn(),
    onKillSelected: vi.fn(),
    onKillRosterActive: vi.fn(),
    onRestartSelected: vi.fn(),
    onRestartRosterActive: vi.fn(),
    onRenameSelected: vi.fn(),
    onToggleMovementModeSelected: vi.fn(),
    onActivateRosterIndex: vi.fn(),
    onScatterSelected: vi.fn(),
    runSpawn: vi.fn(),
    focusRallyCommandInput: vi.fn(() => false),
    escapeTerminalFocus: vi.fn(() => false),
    isTerminalEscapeShortcut: vi.fn(() => false),
    ...overrides
  };
}

function keydown(overrides: {
  key: string;
  code?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: EventTarget | null;
  preventDefault?: () => void;
}): KeyboardEvent {
  return {
    key: overrides.key,
    code: overrides.code ?? "",
    ctrlKey: overrides.ctrlKey ?? false,
    metaKey: overrides.metaKey ?? false,
    altKey: overrides.altKey ?? false,
    shiftKey: overrides.shiftKey ?? false,
    target: overrides.target ?? null,
    preventDefault: overrides.preventDefault ?? (() => {}),
    stopPropagation: () => {}
  } as unknown as KeyboardEvent;
}

// Mirrors the store's applySelection: member focus only sticks once the selection is a group.
function applySelectionInto(getContext: () => HotkeyContext) {
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
    const context = baseContext({
      activeWorkers: [worker("worker-1"), worker("worker-2")],
      applySelection,
      controlGroups: { 2: ["worker-1", "worker-2"] },
      selectedWorkerIds: []
    });

    expect(runHotkeyRegistry(keydown({ key: "2", code: "Digit2", preventDefault }), context)).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(applySelection).toHaveBeenCalledWith(["worker-1", "worker-2"], { center: true });
  });

  it("cycles sparse numbered groups from a focused member and wraps", () => {
    const preventDefault = vi.fn();
    const context = baseContext({
      activeWorkers: [worker("worker-5-a"), worker("worker-5-b"), worker("worker-6"), worker("worker-8")],
      controlGroups: {
        5: ["worker-5-a", "worker-5-b"],
        6: ["worker-6"],
        8: ["worker-8"]
      },
      focusedSelectedWorkerId: "worker-5-b",
      selectedWorkerIds: ["worker-5-b"]
    });
    const applySelection = vi.fn(applySelectionInto(() => context));
    context.applySelection = applySelection;
    const event = keydown({ key: "`", code: "Backquote", preventDefault });

    runHotkeyRegistry(event, context);
    runHotkeyRegistry(event, context);
    runHotkeyRegistry(event, context);

    expect(applySelection.mock.calls).toEqual([
      [["worker-6"], { center: true, focusWorkerId: "worker-6" }],
      [["worker-8"], { center: true, focusWorkerId: "worker-8" }],
      [["worker-5-a", "worker-5-b"], { center: true, focusWorkerId: "worker-5-a" }]
    ]);
    expect(preventDefault).toHaveBeenCalledTimes(3);
  });

  it("cycles sparse numbered groups backwards with shift and wraps", () => {
    const preventDefault = vi.fn();
    const context = baseContext({
      activeWorkers: [worker("worker-5-a"), worker("worker-5-b"), worker("worker-6"), worker("worker-8")],
      controlGroups: {
        5: ["worker-5-a", "worker-5-b"],
        6: ["worker-6"],
        8: ["worker-8"]
      },
      focusedSelectedWorkerId: "worker-5-b",
      selectedWorkerIds: ["worker-5-b"]
    });
    const applySelection = vi.fn(applySelectionInto(() => context));
    context.applySelection = applySelection;
    const event = keydown({ key: "~", code: "Backquote", shiftKey: true, preventDefault });

    runHotkeyRegistry(event, context);
    runHotkeyRegistry(event, context);
    runHotkeyRegistry(event, context);

    expect(applySelection.mock.calls).toEqual([
      [["worker-8"], { center: true, focusWorkerId: "worker-8" }],
      [["worker-6"], { center: true, focusWorkerId: "worker-6" }],
      [["worker-5-a", "worker-5-b"], { center: true, focusWorkerId: "worker-5-a" }]
    ]);
    expect(preventDefault).toHaveBeenCalledTimes(3);
  });

  it("starts backwards cycling at the last populated group without a focused selection", () => {
    const applySelection = vi.fn();
    const context = baseContext({
      activeWorkers: [worker("worker-3"), worker("worker-7")],
      applySelection,
      controlGroups: { 3: ["worker-3"], 7: ["worker-7"] },
      focusedSelectedWorkerId: undefined,
      selectedWorkerIds: []
    });

    runHotkeyRegistry(keydown({ key: "~", code: "Backquote", shiftKey: true }), context);

    expect(applySelection).toHaveBeenCalledWith(["worker-7"], { center: true, focusWorkerId: "worker-7" });
  });

  it("focuses the group member listed first, not the one stored first in the group", () => {
    const applySelection = vi.fn();
    const context = baseContext({
      activeWorkers: [worker("worker-a"), worker("worker-z")],
      applySelection,
      controlGroups: { 4: ["worker-z", "worker-a"] },
      focusedSelectedWorkerId: undefined,
      selectedWorkerIds: []
    });

    runHotkeyRegistry(keydown({ key: "`", code: "Backquote" }), context);

    expect(applySelection).toHaveBeenCalledWith(["worker-z", "worker-a"], {
      center: true,
      focusWorkerId: "worker-a"
    });
  });

  it("keeps the group page when a group is selected by digit", () => {
    const applySelection = vi.fn();
    const context = baseContext({
      activeWorkers: [worker("worker-1"), worker("worker-2")],
      applySelection,
      controlGroups: { 2: ["worker-1", "worker-2"] },
      selectedWorkerIds: []
    });

    runHotkeyRegistry(keydown({ key: "2", code: "Digit2" }), context);

    expect(applySelection).toHaveBeenCalledWith(["worker-1", "worker-2"], { center: true });
  });

  it("starts cycling at the first populated group without a focused selection", () => {
    const applySelection = vi.fn();
    const context = baseContext({
      activeWorkers: [worker("worker-3"), worker("worker-7")],
      applySelection,
      controlGroups: { 3: ["worker-3"], 7: ["worker-7"] },
      focusedSelectedWorkerId: undefined,
      selectedWorkerIds: []
    });

    runHotkeyRegistry(keydown({ key: "`", code: "Backquote" }), context);

    expect(applySelection).toHaveBeenCalledWith(["worker-3"], { center: true, focusWorkerId: "worker-3" });
  });
});

describe("confirm-dialog system hotkeys", () => {
  it("ignores bare modifier keydowns while the kill confirm is open", () => {
    const context = baseContext({ pendingConfirm: { kind: "kill", workerIds: ["worker-1"] } });

    for (const key of ["Shift", "Control", "Alt", "Meta", "CapsLock"]) {
      const preventDefault = vi.fn();
      // Not handled: routing must continue, and the dialog must not react.
      expect(runHotkeyRegistry(keydown({ key, shiftKey: key === "Shift", preventDefault }), context)).toBe(false);
      expect(preventDefault).not.toHaveBeenCalled();
    }

    expect(context.clearConfirm).not.toHaveBeenCalled();
    expect(context.confirmPending).not.toHaveBeenCalled();
  });

  it("confirms the kill selection on unmodified Enter", () => {
    const context = baseContext({ pendingConfirm: { kind: "kill", workerIds: ["worker-1"] } });
    const preventDefault = vi.fn();

    expect(runHotkeyRegistry(keydown({ key: "Enter", preventDefault }), context)).toBe(true);
    expect(context.confirmPending).toHaveBeenCalledOnce();
    expect(context.clearConfirm).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("dismisses the kill confirm on a non-modifier, non-Enter key", () => {
    const context = baseContext({ pendingConfirm: { kind: "kill", workerIds: ["worker-1"] } });
    const preventDefault = vi.fn();

    expect(runHotkeyRegistry(keydown({ key: "a", preventDefault }), context)).toBe(true);
    expect(context.clearConfirm).toHaveBeenCalledOnce();
    expect(context.confirmPending).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("applies the same contract to the restart confirm dialog", () => {
    const shiftContext = baseContext({ pendingConfirm: { kind: "restart", workerIds: ["worker-1"] } });
    const shiftPreventDefault = vi.fn();
    expect(
      runHotkeyRegistry(keydown({ key: "Shift", shiftKey: true, preventDefault: shiftPreventDefault }), shiftContext)
    ).toBe(false);
    expect(shiftContext.clearConfirm).not.toHaveBeenCalled();
    expect(shiftContext.confirmPending).not.toHaveBeenCalled();
    expect(shiftPreventDefault).not.toHaveBeenCalled();

    const enterContext = baseContext({ pendingConfirm: { kind: "restart", workerIds: ["worker-1"] } });
    expect(runHotkeyRegistry(keydown({ key: "Enter", preventDefault: vi.fn() }), enterContext)).toBe(true);
    expect(enterContext.confirmPending).toHaveBeenCalledOnce();
    expect(enterContext.clearConfirm).not.toHaveBeenCalled();

    const letterContext = baseContext({ pendingConfirm: { kind: "restart", workerIds: ["worker-1"] } });
    expect(runHotkeyRegistry(keydown({ key: "x", preventDefault: vi.fn() }), letterContext)).toBe(true);
    expect(letterContext.clearConfirm).toHaveBeenCalledOnce();
    expect(letterContext.confirmPending).not.toHaveBeenCalled();
  });
});

describe("hotkey reference", () => {
  it("renders every documented binding grouped into sections with the configured leave chord", () => {
    const sections = getHotkeyReference({ leaveTerminalFocusHotkeys: ["ctrl+["] });
    const rows = sections.flatMap((section) => section.rows);

    // Every binding that carries doc metadata shows up exactly once.
    const documentedBindings = hotkeyBindings.filter((binding) => binding.doc);
    for (const binding of documentedBindings) {
      expect(rows).toContainEqual({ keys: binding.doc!.keys, description: binding.doc!.description });
    }

    // The configured leave-terminal chord is injected (it is not a static binding).
    expect(rows.some((row) => row.keys === "ctrl+[")).toBe(true);
    // Map-motion rows that live outside the registry are still present.
    expect(rows.some((row) => row.description.includes("Zoom map"))).toBe(true);
  });
});
