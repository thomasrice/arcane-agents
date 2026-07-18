import type { ShortcutConfig, Worker } from "../../shared/types";
import type { RosterEntry } from "../app/types";
import type { AppState } from "./appStore";

// Derived views over the store state. These are plain functions so they can be
// used directly with `useAppStore(selector)` / `useAppStore(useShallow(selector))`
// and also composed inside store actions and reconciliation effects.
//
// Selectors that return a freshly-allocated array of stable `Worker` refs
// (activeWorkers, selectedWorkers, ...) are safe with `useShallow`. Selectors
// that wrap results in new objects each call (rosterEntries) are NOT
// shallow-stable — callers memoise those over their primitive inputs instead.

export function selectActiveWorkers(state: AppState): Worker[] {
  const respawning = new Set(state.respawningWorkerIds);
  return state.workers.filter((worker) => worker.status !== "stopped" && !respawning.has(worker.id));
}

export function selectVoiceLineWorkers(state: AppState): Worker[] {
  return state.workers.filter((worker) => worker.status !== "stopped");
}

export function selectSelectedWorkerId(state: AppState): string | undefined {
  return state.selectedWorkerIds.length === 1 ? state.selectedWorkerIds[0] : undefined;
}

export function selectSelectedWorkers(state: AppState): Worker[] {
  const selected = new Set(state.selectedWorkerIds);
  return selectActiveWorkers(state).filter((worker) => selected.has(worker.id));
}

export function selectSelectedWorker(state: AppState): Worker | undefined {
  const selectedWorkerId = selectSelectedWorkerId(state);
  if (!selectedWorkerId) {
    return undefined;
  }

  return selectActiveWorkers(state).find((worker) => worker.id === selectedWorkerId);
}

export function selectFocusedSelectedWorker(state: AppState): Worker | undefined {
  if (!state.focusedSelectedWorkerId) {
    return undefined;
  }

  return selectSelectedWorkers(state).find((worker) => worker.id === state.focusedSelectedWorkerId);
}

// The terminal shows the single selected worker, or — for a group selection —
// the focused member once one is chosen (otherwise the group page renders).
export function selectTerminalWorker(state: AppState): Worker | undefined {
  const selectedWorker = selectSelectedWorker(state);
  if (selectedWorker) {
    return selectedWorker;
  }

  const selectedWorkers = selectSelectedWorkers(state);
  return selectedWorkers.length > 1 ? selectFocusedSelectedWorker(state) : undefined;
}

export function selectInSelectedGroupView(state: AppState): boolean {
  return selectSelectedWorkers(state).length > 1 && !selectTerminalWorker(state);
}

export function selectSummonShortcuts(state: AppState): ShortcutConfig[] {
  return state.config?.shortcuts ?? [];
}

export function selectRosterEntries(state: AppState): RosterEntry[] {
  const shortcuts = state.config?.shortcuts ?? [];
  return [
    ...selectActiveWorkers(state).map((worker) => ({ kind: "worker", worker }) as const),
    ...shortcuts.map((shortcut, shortcutIndex) => ({ kind: "shortcut", shortcut, shortcutIndex }) as const)
  ];
}

export function selectFirstSummonEntryIndex(state: AppState): number | undefined {
  const firstIndex = selectRosterEntries(state).findIndex((entry) => entry.kind === "shortcut");
  return firstIndex >= 0 ? firstIndex : undefined;
}

function workersById(workers: Worker[]): Map<string, Worker> {
  return new Map(workers.map((worker) => [worker.id, worker]));
}

function resolveWorkers(workers: Worker[], workerIds: string[]): Worker[] {
  if (workerIds.length === 0) {
    return [];
  }

  const byId = workersById(workers);
  return workerIds.map((workerId) => byId.get(workerId)).filter((worker): worker is Worker => Boolean(worker));
}

// Confirm/rename targets resolve against the full worker list (including workers
// that have gone stopped), matching the pre-store behaviour.
export function selectConfirmWorkers(state: AppState): Worker[] {
  return state.pendingConfirm ? resolveWorkers(state.workers, state.pendingConfirm.workerIds) : [];
}

export function selectRenameTargetWorkers(state: AppState): Worker[] {
  return resolveWorkers(state.workers, state.renameTargetWorkerIds);
}
