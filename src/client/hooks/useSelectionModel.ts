import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { Worker } from "../../shared/types";
import type { RosterEntry } from "../app/types";
import { clampNumber } from "../app/utils";

interface UseSelectionModelResult {
  selectedWorkerIds: string[];
  setSelectedWorkerIds: Dispatch<SetStateAction<string[]>>;
  selectedWorkerId: string | undefined;
  selectedWorkers: Worker[];
  mapCenterToken: number;
  mapCenterWorkerId: string | undefined;
  terminalFocusToken: number | undefined;
  rosterActiveIndex: number;
  setRosterActiveIndex: Dispatch<SetStateAction<number>>;
  selectedGroupActiveIndex: number;
  setSelectedGroupActiveIndex: Dispatch<SetStateAction<number>>;
  focusedSelectedWorkerId: string | undefined;
  setFocusedSelectedWorkerId: Dispatch<SetStateAction<string | undefined>>;
  applySelection: (workerIds: string[], options?: { center?: boolean; focusTerminal?: boolean }) => void;
  requestTerminalFocus: () => void;
  onSelectWorker: (workerId: string | undefined) => void;
  onSelectionChange: (workerIds: string[]) => void;
  onActivateWorker: (workerId: string) => void;
  cycleSelection: (direction: 1 | -1) => void;
  cycleIdleSelection: (direction: 1 | -1) => void;
  cycleSelectedGroupFocus: (direction: 1 | -1) => void;
}

export function useSelectionModel(
  activeWorkers: Worker[],
  rosterEntries: RosterEntry[],
  onSelectedGroupCollapsed?: () => void
): UseSelectionModelResult {
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([]);
  const [mapCenterToken, setMapCenterToken] = useState(0);
  const [mapCenterWorkerId, setMapCenterWorkerId] = useState<string | undefined>(undefined);
  const [terminalFocusToken, setTerminalFocusToken] = useState<number | undefined>(undefined);
  const [rosterActiveIndex, setRosterActiveIndex] = useState(0);
  const [selectedGroupActiveIndex, setSelectedGroupActiveIndex] = useState(0);
  const [focusedSelectedWorkerId, setFocusedSelectedWorkerId] = useState<string | undefined>(undefined);

  const selectedWorkerId = selectedWorkerIds.length === 1 ? selectedWorkerIds[0] : undefined;
  const selectedWorkerIdSet = useMemo(() => new Set(selectedWorkerIds), [selectedWorkerIds]);
  const selectedWorkers = useMemo(
    () => activeWorkers.filter((worker) => selectedWorkerIdSet.has(worker.id)),
    [activeWorkers, selectedWorkerIdSet]
  );
  const idleWorkers = useMemo(() => activeWorkers.filter((worker) => worker.status === "idle"), [activeWorkers]);

  const applySelection = useCallback((workerIds: string[], options?: { center?: boolean; focusTerminal?: boolean }) => {
    const deduped = Array.from(new Set(workerIds));
    setSelectedWorkerIds(deduped);
    setFocusedSelectedWorkerId(undefined);

    const primaryWorkerId = deduped.length === 1 ? deduped[0] : undefined;
    if (options?.center && primaryWorkerId) {
      setMapCenterWorkerId(primaryWorkerId);
      setMapCenterToken((current) => current + 1);
    }

    if (options?.focusTerminal && primaryWorkerId) {
      setTerminalFocusToken((current) => (current ?? 0) + 1);
    } else {
      setTerminalFocusToken(undefined);
    }
  }, []);

  const requestTerminalFocus = useCallback(() => {
    setTerminalFocusToken((current) => (current ?? 0) + 1);
  }, []);

  const onSelectWorker = useCallback(
    (workerId: string | undefined) => {
      applySelection(workerId ? [workerId] : []);
    },
    [applySelection]
  );

  const onSelectionChange = useCallback(
    (workerIds: string[]) => {
      applySelection(workerIds);
    },
    [applySelection]
  );

  const onActivateWorker = useCallback(
    (workerId: string) => {
      applySelection([workerId], { focusTerminal: true });
    },
    [applySelection]
  );

  const cycleSelection = useCallback(
    (direction: 1 | -1) => {
      if (activeWorkers.length === 0) {
        return;
      }

      const currentIndex = activeWorkers.findIndex((worker) => worker.id === selectedWorkerId);
      const startIndex = currentIndex >= 0 ? currentIndex : direction > 0 ? -1 : 0;
      const nextIndex = (startIndex + direction + activeWorkers.length) % activeWorkers.length;
      const nextWorker = activeWorkers[nextIndex];
      if (!nextWorker) {
        return;
      }

      applySelection([nextWorker.id], { center: true });
    },
    [activeWorkers, applySelection, selectedWorkerId]
  );

  const cycleIdleSelection = useCallback(
    (direction: 1 | -1) => {
      if (idleWorkers.length === 0) {
        return;
      }

      const currentIndex = idleWorkers.findIndex((worker) => worker.id === selectedWorkerId);
      const startIndex = currentIndex >= 0 ? currentIndex : direction > 0 ? -1 : 0;
      const nextIndex = (startIndex + direction + idleWorkers.length) % idleWorkers.length;
      const nextWorker = idleWorkers[nextIndex];
      if (!nextWorker) {
        return;
      }

      applySelection([nextWorker.id], { center: true });
    },
    [applySelection, idleWorkers, selectedWorkerId]
  );

  const cycleSelectedGroupFocus = useCallback(
    (direction: 1 | -1) => {
      if (selectedWorkers.length <= 1) {
        return;
      }

      const currentIndex = focusedSelectedWorkerId
        ? selectedWorkers.findIndex((worker) => worker.id === focusedSelectedWorkerId)
        : clampNumber(selectedGroupActiveIndex, 0, selectedWorkers.length - 1);
      const startIndex = currentIndex >= 0 ? currentIndex : direction > 0 ? -1 : 0;
      const nextIndex = (startIndex + direction + selectedWorkers.length) % selectedWorkers.length;
      const nextWorker = selectedWorkers[nextIndex];
      if (!nextWorker) {
        return;
      }

      setSelectedGroupActiveIndex(nextIndex);
      setFocusedSelectedWorkerId(nextWorker.id);
    },
    [focusedSelectedWorkerId, selectedGroupActiveIndex, selectedWorkers]
  );

  useEffect(() => {
    if (rosterEntries.length === 0) {
      setRosterActiveIndex(0);
      return;
    }

    if (selectedWorkerId) {
      const selectedIndex = rosterEntries.findIndex((entry) => entry.kind === "worker" && entry.worker.id === selectedWorkerId);
      if (selectedIndex >= 0) {
        setRosterActiveIndex(selectedIndex);
      }
      return;
    }

    setRosterActiveIndex((current) => clampNumber(current, 0, rosterEntries.length - 1));
  }, [rosterEntries, selectedWorkerId]);

  useEffect(() => {
    if (selectedWorkers.length <= 1) {
      setSelectedGroupActiveIndex(0);
      setFocusedSelectedWorkerId(undefined);
      onSelectedGroupCollapsed?.();
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
  }, [focusedSelectedWorkerId, onSelectedGroupCollapsed, selectedWorkers]);

  useEffect(() => {
    const activeIds = new Set(activeWorkers.map((worker) => worker.id));
    setSelectedWorkerIds((current) => current.filter((workerId) => activeIds.has(workerId)));
  }, [activeWorkers]);

  return {
    selectedWorkerIds,
    setSelectedWorkerIds,
    selectedWorkerId,
    selectedWorkers,
    mapCenterToken,
    mapCenterWorkerId,
    terminalFocusToken,
    rosterActiveIndex,
    setRosterActiveIndex,
    selectedGroupActiveIndex,
    setSelectedGroupActiveIndex,
    focusedSelectedWorkerId,
    setFocusedSelectedWorkerId,
    applySelection,
    requestTerminalFocus,
    onSelectWorker,
    onSelectionChange,
    onActivateWorker,
    cycleSelection,
    cycleIdleSelection,
    cycleSelectedGroupFocus
  };
}
