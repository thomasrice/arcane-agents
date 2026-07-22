import { create } from "zustand";
import type { ResolvedConfig, Worker } from "../../shared/types";
import { defaultMapColumnRatio, maxMapColumnRatio, minMapColumnRatio } from "../app/constants";
import type { ConfirmKind, ControlGroupMap, OpenDialog, PendingConfirm } from "../app/types";
import {
  clampNumber,
  loadControlGroupsFromStorage,
  loadMapColumnRatioFromStorage,
  persistControlGroups,
  persistMapColumnRatio,
  upsertWorker as upsertWorkerInList
} from "../app/utils";
import { requestCenterOnWorkers, requestTerminalFocus } from "./imperativeBridge";
import { selectActiveWorkers, selectSelectedWorkerId, selectSelectedWorkers } from "./selectors";

export type Updater<T> = T | ((prev: T) => T);

export interface ApplySelectionOptions {
  center?: boolean;
  focusTerminal?: boolean;
  focusWorkerId?: string;
}

export interface AppState {
  // Server-synced data
  config: ResolvedConfig | null;
  workers: Worker[];
  workersHydrated: boolean;
  errorText: string | undefined;

  // Selection
  selectedWorkerIds: string[];
  focusedSelectedWorkerId: string | undefined;
  rosterActiveIndex: number;
  selectedGroupActiveIndex: number;

  // Modal / flow state
  openDialog: OpenDialog;
  pendingConfirm: PendingConfirm | null;
  renameTargetWorkerIds: string[];
  renameDraft: string;
  respawningWorkerIds: string[];

  // Layout & control groups
  mapColumnRatio: number;
  controlGroups: ControlGroupMap;
}

export interface AppActions {
  // Server sync
  setConfig: (config: ResolvedConfig) => void;
  setWorkers: (workers: Worker[]) => void;
  upsertWorker: (worker: Worker) => void;
  removeWorker: (workerId: string) => void;
  setErrorText: (text: string | undefined) => void;

  // Selection
  applySelection: (workerIds: string[], options?: ApplySelectionOptions) => void;
  requestTerminalFocus: () => void;
  onSelectWorker: (workerId: string | undefined) => void;
  onSelectionChange: (workerIds: string[]) => void;
  onActivateWorker: (workerId: string) => void;
  cycleSelection: (direction: 1 | -1) => void;
  cycleIdleSelection: (direction: 1 | -1) => void;
  cycleReviewSelection: (direction: 1 | -1, pendingCompletionWorkerIds: readonly string[]) => void;
  cycleSelectedGroupFocus: (direction: 1 | -1) => void;
  setSelectedWorkerIds: (update: Updater<string[]>) => void;
  setRosterActiveIndex: (update: Updater<number>) => void;
  setSelectedGroupActiveIndex: (update: Updater<number>) => void;
  setFocusedSelectedWorkerId: (update: Updater<string | undefined>) => void;

  // Dialogs
  setOpenDialog: (dialog: OpenDialog) => void;
  setSpawnDialogOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  setBatchSpawnDialogOpen: (open: boolean) => void;
  setShortcutsOverlayOpen: (update: Updater<boolean>) => void;

  // Rename
  openRenameForWorkers: (workers: Worker[]) => void;
  closeRename: () => void;
  setRenameDraft: (draft: string) => void;

  // Confirm (kill / restart)
  requestConfirm: (kind: ConfirmKind, workerIds: string[]) => void;
  clearConfirm: () => void;

  // Respawning
  setRespawningWorkerIds: (update: Updater<string[]>) => void;

  // Worker-driven reconciliation (replaces the compensating auto-close effects)
  reconcileToActiveWorkers: (activeWorkerIds: string[]) => void;

  // Layout & control groups
  setMapColumnRatio: (value: number) => void;
  nudgeMapColumnRatio: (delta: number) => void;
  resetMapColumnRatio: () => void;
  setControlGroups: (update: Updater<ControlGroupMap>) => void;
}

export type AppStore = AppState & AppActions;

function applyUpdate<T>(update: Updater<T>, prev: T): T {
  return typeof update === "function" ? (update as (previous: T) => T)(prev) : update;
}

function commitMapColumnRatio(current: number, next: number): Partial<AppState> {
  const clamped = clampNumber(next, minMapColumnRatio, maxMapColumnRatio);
  if (clamped === current) {
    return {};
  }

  persistMapColumnRatio(clamped);
  return { mapColumnRatio: clamped };
}

function cycleWorkerSelection(state: AppStore, workers: readonly Worker[], direction: 1 | -1): void {
  if (workers.length === 0) {
    return;
  }

  const selectedWorkerId = selectSelectedWorkerId(state);
  const currentIndex = workers.findIndex((worker) => worker.id === selectedWorkerId);
  const startIndex = currentIndex >= 0 ? currentIndex : direction > 0 ? -1 : 0;
  const nextIndex = (startIndex + direction + workers.length) % workers.length;
  const nextWorker = workers[nextIndex];
  if (!nextWorker) {
    return;
  }

  state.applySelection([nextWorker.id], { center: true });
}

export const useAppStore = create<AppStore>()((set, get) => ({
  config: null,
  workers: [],
  workersHydrated: false,
  errorText: undefined,

  selectedWorkerIds: [],
  focusedSelectedWorkerId: undefined,
  rosterActiveIndex: 0,
  selectedGroupActiveIndex: 0,

  openDialog: null,
  pendingConfirm: null,
  renameTargetWorkerIds: [],
  renameDraft: "",
  respawningWorkerIds: [],

  mapColumnRatio: loadMapColumnRatioFromStorage(),
  controlGroups: loadControlGroupsFromStorage(),

  setConfig: (config) => set({ config }),
  setWorkers: (workers) => set({ workers, workersHydrated: true }),
  upsertWorker: (worker) => set((state) => ({ workers: upsertWorkerInList(state.workers, worker) })),
  removeWorker: (workerId) => set((state) => ({ workers: state.workers.filter((worker) => worker.id !== workerId) })),
  setErrorText: (text) => set({ errorText: text }),

  applySelection: (workerIds, options) => {
    const deduped = Array.from(new Set(workerIds));
    const primaryWorkerId = deduped.length === 1 ? deduped[0] : undefined;

    set({
      selectedWorkerIds: deduped,
      // Focusing a member swaps the group page for that member's terminal, so
      // it only sticks once the selection is actually a group.
      focusedSelectedWorkerId:
        options?.focusWorkerId && deduped.length > 1 && deduped.includes(options.focusWorkerId)
          ? options.focusWorkerId
          : undefined
    });

    // Imperative map/terminal commands are dispatched through the bridge to the live
    // component handles (replaces the old center/focus counter-token state).
    if (options?.center && deduped.length > 0) {
      requestCenterOnWorkers(deduped);
    }

    if (options?.focusTerminal && primaryWorkerId) {
      requestTerminalFocus();
    }
  },

  requestTerminalFocus: () => requestTerminalFocus(),
  onSelectWorker: (workerId) => get().applySelection(workerId ? [workerId] : []),
  onSelectionChange: (workerIds) => get().applySelection(workerIds),
  onActivateWorker: (workerId) => get().applySelection([workerId], { focusTerminal: true }),

  cycleSelection: (direction) => {
    const state = get();
    cycleWorkerSelection(state, selectActiveWorkers(state), direction);
  },

  cycleIdleSelection: (direction) => {
    const state = get();
    const idleWorkers = selectActiveWorkers(state).filter((worker) => worker.status === "idle");
    cycleWorkerSelection(state, idleWorkers, direction);
  },

  cycleReviewSelection: (direction, pendingCompletionWorkerIds) => {
    const state = get();
    const pendingCompletionWorkerIdSet = new Set(pendingCompletionWorkerIds);
    const workersNeedingReview = selectActiveWorkers(state).filter(
      (worker) =>
        worker.status === "attention" ||
        (worker.status === "idle" && pendingCompletionWorkerIdSet.has(worker.id))
    );
    cycleWorkerSelection(state, workersNeedingReview, direction);
  },

  cycleSelectedGroupFocus: (direction) => {
    const state = get();
    const selectedWorkers = selectSelectedWorkers(state);
    if (selectedWorkers.length <= 1) {
      return;
    }

    const currentIndex = state.focusedSelectedWorkerId
      ? selectedWorkers.findIndex((worker) => worker.id === state.focusedSelectedWorkerId)
      : clampNumber(state.selectedGroupActiveIndex, 0, selectedWorkers.length - 1);
    const startIndex = currentIndex >= 0 ? currentIndex : direction > 0 ? -1 : 0;
    const nextIndex = (startIndex + direction + selectedWorkers.length) % selectedWorkers.length;
    const nextWorker = selectedWorkers[nextIndex];
    if (!nextWorker) {
      return;
    }

    set({ selectedGroupActiveIndex: nextIndex, focusedSelectedWorkerId: nextWorker.id });
  },

  setSelectedWorkerIds: (update) => set((state) => ({ selectedWorkerIds: applyUpdate(update, state.selectedWorkerIds) })),
  setRosterActiveIndex: (update) => set((state) => ({ rosterActiveIndex: applyUpdate(update, state.rosterActiveIndex) })),
  setSelectedGroupActiveIndex: (update) =>
    set((state) => ({ selectedGroupActiveIndex: applyUpdate(update, state.selectedGroupActiveIndex) })),
  setFocusedSelectedWorkerId: (update) =>
    set((state) => ({ focusedSelectedWorkerId: applyUpdate(update, state.focusedSelectedWorkerId) })),

  setOpenDialog: (dialog) => set({ openDialog: dialog }),
  setSpawnDialogOpen: (open) =>
    set((state) => ({ openDialog: open ? "spawn" : state.openDialog === "spawn" ? null : state.openDialog })),
  setPaletteOpen: (open) =>
    set((state) => ({ openDialog: open ? "palette" : state.openDialog === "palette" ? null : state.openDialog })),
  setBatchSpawnDialogOpen: (open) =>
    set((state) => ({ openDialog: open ? "batchSpawn" : state.openDialog === "batchSpawn" ? null : state.openDialog })),
  setShortcutsOverlayOpen: (update) =>
    set((state) => {
      const nextOpen = applyUpdate(update, state.openDialog === "shortcuts");
      return { openDialog: nextOpen ? "shortcuts" : state.openDialog === "shortcuts" ? null : state.openDialog };
    }),

  openRenameForWorkers: (workers) => {
    if (workers.length === 0) {
      return;
    }

    set({
      renameDraft: workers.length === 1 ? workers[0].displayName ?? workers[0].name : "",
      renameTargetWorkerIds: workers.map((worker) => worker.id),
      openDialog: "rename"
    });
  },
  closeRename: () =>
    set((state) => ({
      openDialog: state.openDialog === "rename" ? null : state.openDialog,
      renameTargetWorkerIds: []
    })),
  setRenameDraft: (draft) => set({ renameDraft: draft }),

  requestConfirm: (kind, workerIds) => {
    if (workerIds.length === 0) {
      return;
    }

    set({ pendingConfirm: { kind, workerIds } });
  },
  clearConfirm: () => set({ pendingConfirm: null }),

  setRespawningWorkerIds: (update) =>
    set((state) => ({ respawningWorkerIds: applyUpdate(update, state.respawningWorkerIds) })),

  reconcileToActiveWorkers: (activeWorkerIds) =>
    set((state) => {
      const activeIdSet = new Set(activeWorkerIds);
      const next: Partial<AppState> = {};

      const prunedSelection = state.selectedWorkerIds.filter((workerId) => activeIdSet.has(workerId));
      if (prunedSelection.length !== state.selectedWorkerIds.length) {
        next.selectedWorkerIds = prunedSelection;
      }

      if (state.pendingConfirm && !state.pendingConfirm.workerIds.some((workerId) => activeIdSet.has(workerId))) {
        next.pendingConfirm = null;
      }

      if (
        state.openDialog === "rename" &&
        state.renameTargetWorkerIds.length > 0 &&
        !state.renameTargetWorkerIds.some((workerId) => activeIdSet.has(workerId))
      ) {
        next.openDialog = null;
        next.renameTargetWorkerIds = [];
      }

      return next;
    }),

  setMapColumnRatio: (value) => set((state) => commitMapColumnRatio(state.mapColumnRatio, value)),
  nudgeMapColumnRatio: (delta) => set((state) => commitMapColumnRatio(state.mapColumnRatio, state.mapColumnRatio + delta)),
  resetMapColumnRatio: () => set((state) => commitMapColumnRatio(state.mapColumnRatio, defaultMapColumnRatio)),
  setControlGroups: (update) =>
    set((state) => {
      const next = applyUpdate(update, state.controlGroups);
      if (next === state.controlGroups) {
        return {};
      }

      persistControlGroups(next);
      return { controlGroups: next };
    })
}));
