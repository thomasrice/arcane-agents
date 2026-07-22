import { beforeEach, describe, expect, it } from "vitest";
import type { Worker } from "../../shared/types";
import { useAppStore } from "./appStore";
import { selectActiveWorkers, selectConfirmWorkers, selectRenameTargetWorkers } from "./selectors";

function worker(id: string, overrides: Partial<Worker> = {}): Worker {
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
    ...overrides
  };
}

beforeEach(() => {
  useAppStore.setState({
    config: null,
    workers: [],
    workersHydrated: false,
    errorText: undefined,
    selectedWorkerIds: [],
    reviewSessionWorkerIds: null,
    focusedSelectedWorkerId: undefined,
    rosterActiveIndex: 0,
    selectedGroupActiveIndex: 0,
    openDialog: null,
    pendingConfirm: null,
    renameTargetWorkerIds: [],
    renameDraft: "",
    respawningWorkerIds: [],
    controlGroups: {}
  });
});

describe("dialog exclusivity", () => {
  it("opening one dialog closes whichever was open", () => {
    const store = useAppStore.getState();

    store.setPaletteOpen(true);
    expect(useAppStore.getState().openDialog).toBe("palette");

    store.setSpawnDialogOpen(true);
    expect(useAppStore.getState().openDialog).toBe("spawn");

    store.setShortcutsOverlayOpen(true);
    expect(useAppStore.getState().openDialog).toBe("shortcuts");

    store.openRenameForWorkers([worker("a")]);
    expect(useAppStore.getState().openDialog).toBe("rename");
  });

  it("closing a dialog only clears it when it is the open one", () => {
    const store = useAppStore.getState();
    store.setPaletteOpen(true);

    // A stale close for a different dialog must not clobber the open one.
    store.setSpawnDialogOpen(false);
    expect(useAppStore.getState().openDialog).toBe("palette");

    store.setPaletteOpen(false);
    expect(useAppStore.getState().openDialog).toBeNull();
  });
});

describe("rename flow", () => {
  it("holds a non-empty target exactly while the rename dialog is open", () => {
    const store = useAppStore.getState();

    store.openRenameForWorkers([worker("a", { displayName: "Alpha" })]);
    expect(useAppStore.getState().openDialog).toBe("rename");
    expect(useAppStore.getState().renameTargetWorkerIds).toEqual(["a"]);
    expect(useAppStore.getState().renameDraft).toBe("Alpha");

    store.closeRename();
    expect(useAppStore.getState().openDialog).toBeNull();
    expect(useAppStore.getState().renameTargetWorkerIds).toEqual([]);
  });

  it("ignores an empty rename request", () => {
    const store = useAppStore.getState();
    store.openRenameForWorkers([]);
    expect(useAppStore.getState().openDialog).toBeNull();
    expect(useAppStore.getState().renameTargetWorkerIds).toEqual([]);
  });
});

describe("applySelection", () => {
  it("dedupes the selection", () => {
    useAppStore.getState().applySelection(["a", "a", "b", "b", "a"]);
    expect(useAppStore.getState().selectedWorkerIds).toEqual(["a", "b"]);
  });

  it("keeps a focused member only for a group that contains it", () => {
    const store = useAppStore.getState();

    store.applySelection(["a", "b"], { focusWorkerId: "a" });
    expect(useAppStore.getState().focusedSelectedWorkerId).toBe("a");

    // Single selection never carries a focused member.
    store.applySelection(["a"], { focusWorkerId: "a" });
    expect(useAppStore.getState().focusedSelectedWorkerId).toBeUndefined();

    // A focus target outside the selection is dropped.
    store.applySelection(["a", "b"], { focusWorkerId: "c" });
    expect(useAppStore.getState().focusedSelectedWorkerId).toBeUndefined();
  });
});

describe("cycleReviewSelection", () => {
  it("keeps acknowledged workers in forward and reverse review history", () => {
    useAppStore.setState({
      workers: [worker("ready"), worker("attention", { status: "attention" })]
    });
    const store = useAppStore.getState();

    store.cycleReviewSelection(1, ["ready"]);
    expect(useAppStore.getState().selectedWorkerIds).toEqual(["ready"]);
    expect(useAppStore.getState().reviewSessionWorkerIds).toEqual(["ready", "attention"]);

    useAppStore.setState({
      workers: [worker("ready"), worker("attention")]
    });
    store.cycleReviewSelection(1, []);
    expect(useAppStore.getState().selectedWorkerIds).toEqual(["attention"]);

    store.cycleReviewSelection(-1, []);
    expect(useAppStore.getState().selectedWorkerIds).toEqual(["ready"]);
  });

  it("appends newly ready workers once without reordering the session", () => {
    useAppStore.setState({
      workers: [worker("ready"), worker("later")]
    });
    const store = useAppStore.getState();

    store.syncReviewSession(["ready"]);
    expect(useAppStore.getState().reviewSessionWorkerIds).toBeNull();

    store.cycleReviewSelection(1, ["ready"]);
    useAppStore.setState({
      workers: [worker("ready"), worker("later", { status: "attention" })]
    });
    store.syncReviewSession(["ready"]);
    expect(useAppStore.getState().reviewSessionWorkerIds).toEqual(["ready", "later"]);

    useAppStore.setState({
      workers: [worker("ready"), worker("later")]
    });
    store.syncReviewSession(["ready"]);
    store.cycleReviewSelection(1, ["ready"]);
    expect(useAppStore.getState().selectedWorkerIds).toEqual(["later"]);

    store.cycleReviewSelection(1, ["ready"]);
    expect(useAppStore.getState().selectedWorkerIds).toEqual(["ready"]);
    expect(useAppStore.getState().reviewSessionWorkerIds).toEqual(["ready", "later"]);
  });

  it("starts forwards at the first worker and backwards at the last worker", () => {
    useAppStore.setState({
      workers: [worker("unrelated"), worker("ready"), worker("attention", { status: "attention" })],
      selectedWorkerIds: ["unrelated"]
    });

    useAppStore.getState().cycleReviewSelection(-1, ["ready"]);
    expect(useAppStore.getState().selectedWorkerIds).toEqual(["attention"]);

    useAppStore.getState().applySelection(["unrelated"]);
    useAppStore.getState().cycleReviewSelection(1, ["ready"]);
    expect(useAppStore.getState().selectedWorkerIds).toEqual(["ready"]);
  });

  it("resets the session after manual selection or deselection", () => {
    useAppStore.setState({
      workers: [worker("ready"), worker("attention", { status: "attention" }), worker("manual")]
    });
    const store = useAppStore.getState();

    store.cycleReviewSelection(1, ["ready"]);
    store.applySelection(["manual"]);
    expect(useAppStore.getState().reviewSessionWorkerIds).toBeNull();

    useAppStore.setState({
      workers: [worker("ready"), worker("attention"), worker("manual")]
    });
    store.cycleReviewSelection(1, ["ready"]);
    expect(useAppStore.getState().selectedWorkerIds).toEqual(["ready"]);

    store.applySelection([]);
    expect(useAppStore.getState().reviewSessionWorkerIds).toBeNull();
  });

  it("prunes workers that are no longer active", () => {
    useAppStore.setState({
      workers: [worker("ready"), worker("attention", { status: "attention" })]
    });
    const store = useAppStore.getState();

    store.cycleReviewSelection(1, ["ready"]);
    useAppStore.setState({
      workers: [worker("ready"), worker("attention", { status: "stopped" })]
    });
    store.cycleReviewSelection(1, []);

    expect(useAppStore.getState().selectedWorkerIds).toEqual(["ready"]);
    expect(useAppStore.getState().reviewSessionWorkerIds).toEqual(["ready"]);
  });

  it("ignores stale pending IDs and leaves the current selection unchanged without candidates", () => {
    useAppStore.setState({
      workers: [worker("idle"), worker("working", { status: "working" })],
      selectedWorkerIds: ["idle"]
    });

    useAppStore.getState().cycleReviewSelection(1, ["working"]);

    expect(useAppStore.getState().selectedWorkerIds).toEqual(["idle"]);
    expect(useAppStore.getState().reviewSessionWorkerIds).toBeNull();
  });
});

describe("selectActiveWorkers", () => {
  it("excludes stopped and respawning workers", () => {
    useAppStore.setState({
      workers: [worker("a"), worker("b", { status: "stopped" }), worker("c")],
      respawningWorkerIds: ["c"]
    });
    expect(selectActiveWorkers(useAppStore.getState()).map((w) => w.id)).toEqual(["a"]);
  });
});

describe("reconcileToActiveWorkers", () => {
  it("prunes selection to the surviving workers", () => {
    const store = useAppStore.getState();
    store.applySelection(["a", "b", "c"]);
    store.reconcileToActiveWorkers(["a", "c"]);
    expect(useAppStore.getState().selectedWorkerIds).toEqual(["a", "c"]);
  });

  it("closes a confirm only when all its targets have departed", () => {
    const store = useAppStore.getState();

    store.requestConfirm("kill", ["a", "b"]);
    store.reconcileToActiveWorkers(["a"]);
    expect(useAppStore.getState().pendingConfirm).toEqual({ kind: "kill", workerIds: ["a", "b"] });

    store.reconcileToActiveWorkers(["z"]);
    expect(useAppStore.getState().pendingConfirm).toBeNull();
  });

  it("closes the rename dialog when every rename target has departed", () => {
    const store = useAppStore.getState();
    store.openRenameForWorkers([worker("a")]);

    store.reconcileToActiveWorkers(["a"]);
    expect(useAppStore.getState().openDialog).toBe("rename");

    store.reconcileToActiveWorkers(["z"]);
    expect(useAppStore.getState().openDialog).toBeNull();
    expect(useAppStore.getState().renameTargetWorkerIds).toEqual([]);
  });
});

describe("confirm flow", () => {
  it("ignores an empty confirm request", () => {
    useAppStore.getState().requestConfirm("kill", []);
    expect(useAppStore.getState().pendingConfirm).toBeNull();
  });

  it("sets and clears the pending confirm", () => {
    const store = useAppStore.getState();
    store.requestConfirm("restart", ["a"]);
    expect(useAppStore.getState().pendingConfirm).toEqual({ kind: "restart", workerIds: ["a"] });

    store.clearConfirm();
    expect(useAppStore.getState().pendingConfirm).toBeNull();
  });

  it("resolves confirm and rename targets against the full worker list", () => {
    useAppStore.setState({
      workers: [worker("a"), worker("b", { status: "stopped" })],
      pendingConfirm: { kind: "kill", workerIds: ["b"] },
      renameTargetWorkerIds: ["a"]
    });

    // Stopped workers still resolve for confirm/rename targeting.
    expect(selectConfirmWorkers(useAppStore.getState()).map((w) => w.id)).toEqual(["b"]);
    expect(selectRenameTargetWorkers(useAppStore.getState()).map((w) => w.id)).toEqual(["a"]);
  });
});
