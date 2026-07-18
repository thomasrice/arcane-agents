import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { clampNumber } from "../app/utils";
import type { RosterEntry } from "../app/types";
import { useAppStore } from "../state/appStore";
import {
  selectActiveWorkers,
  selectSelectedWorkerId,
  selectSelectedWorkers,
  selectSummonShortcuts
} from "../state/selectors";

// Keeps store state that depends on the live worker list consistent as workers
// appear, change status, and disappear. This single hook replaces five formerly
// scattered effects: App's respawning prune, useSelectionModel's selection prune
// + roster-index + group-focus effects, useLayoutAndControlGroups' control-group
// prune, and useWorkerActionUiState's three compensating confirm/rename
// auto-close effects.
export function useStoreReconciliation(): void {
  const workers = useAppStore((state) => state.workers);
  const workersHydrated = useAppStore((state) => state.workersHydrated);
  const activeWorkers = useAppStore(useShallow(selectActiveWorkers));
  const selectedWorkers = useAppStore(useShallow(selectSelectedWorkers));
  const selectedWorkerId = useAppStore(selectSelectedWorkerId);
  const focusedSelectedWorkerId = useAppStore((state) => state.focusedSelectedWorkerId);
  const summonShortcuts = useAppStore(useShallow(selectSummonShortcuts));

  const setRespawningWorkerIds = useAppStore((state) => state.setRespawningWorkerIds);
  const reconcileToActiveWorkers = useAppStore((state) => state.reconcileToActiveWorkers);
  const setControlGroups = useAppStore((state) => state.setControlGroups);
  const setRosterActiveIndex = useAppStore((state) => state.setRosterActiveIndex);
  const setSelectedGroupActiveIndex = useAppStore((state) => state.setSelectedGroupActiveIndex);
  const setFocusedSelectedWorkerId = useAppStore((state) => state.setFocusedSelectedWorkerId);

  const rosterEntries = useMemo<RosterEntry[]>(
    () => [
      ...activeWorkers.map((worker) => ({ kind: "worker", worker }) as const),
      ...summonShortcuts.map((shortcut, shortcutIndex) => ({ kind: "shortcut", shortcut, shortcutIndex }) as const)
    ],
    [activeWorkers, summonShortcuts]
  );

  // Drop respawning ids for workers that no longer exist at all.
  useEffect(() => {
    const workerIdSet = new Set(workers.map((worker) => worker.id));
    setRespawningWorkerIds((current) => current.filter((workerId) => workerIdSet.has(workerId)));
  }, [workers, setRespawningWorkerIds]);

  // Prune selection, and auto-close confirm/rename flows whose targets have all
  // left the active roster.
  useEffect(() => {
    reconcileToActiveWorkers(activeWorkers.map((worker) => worker.id));
  }, [activeWorkers, reconcileToActiveWorkers]);

  // Prune control groups to active workers once real data has hydrated.
  useEffect(() => {
    if (!workersHydrated) {
      return;
    }

    const activeIds = new Set(activeWorkers.map((worker) => worker.id));
    setControlGroups((current) => {
      let changed = false;
      const next = { ...current };

      for (const [digitText, workerIds] of Object.entries(next)) {
        if (!Array.isArray(workerIds) || workerIds.length === 0) {
          delete next[Number(digitText)];
          changed = true;
          continue;
        }

        const filtered = workerIds.filter((workerId) => activeIds.has(workerId));
        if (filtered.length === workerIds.length) {
          continue;
        }

        if (filtered.length === 0) {
          delete next[Number(digitText)];
        } else {
          next[Number(digitText)] = filtered;
        }
        changed = true;
      }

      return changed ? next : current;
    });
  }, [activeWorkers, workersHydrated, setControlGroups]);

  // Track the roster keyboard cursor against the selection.
  useEffect(() => {
    if (rosterEntries.length === 0) {
      setRosterActiveIndex(0);
      return;
    }

    if (selectedWorkerId) {
      const selectedIndex = rosterEntries.findIndex(
        (entry) => entry.kind === "worker" && entry.worker.id === selectedWorkerId
      );
      if (selectedIndex >= 0) {
        setRosterActiveIndex(selectedIndex);
      }
      return;
    }

    setRosterActiveIndex((current) => clampNumber(current, 0, rosterEntries.length - 1));
  }, [rosterEntries, selectedWorkerId, setRosterActiveIndex]);

  // Maintain the focused member / group cursor.
  useEffect(() => {
    if (selectedWorkers.length <= 1) {
      setSelectedGroupActiveIndex(0);
      setFocusedSelectedWorkerId(undefined);
      return;
    }

    if (focusedSelectedWorkerId) {
      const focusedIndex = selectedWorkers.findIndex((worker) => worker.id === focusedSelectedWorkerId);
      if (focusedIndex >= 0) {
        setSelectedGroupActiveIndex(focusedIndex);
        return;
      }

      setFocusedSelectedWorkerId(undefined);
    }

    setSelectedGroupActiveIndex((current) => clampNumber(current, 0, selectedWorkers.length - 1));
  }, [focusedSelectedWorkerId, selectedWorkers, setSelectedGroupActiveIndex, setFocusedSelectedWorkerId]);
}
