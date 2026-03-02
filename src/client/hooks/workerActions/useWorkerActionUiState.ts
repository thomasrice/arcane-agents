import { useCallback, useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import type { Worker } from "../../../shared/types";

interface UseWorkerActionUiStateParams {
  workers: Worker[];
  activeWorkers: Worker[];
  renameModalOpen: boolean;
  setRenameModalOpen: Dispatch<SetStateAction<boolean>>;
  renameTargetWorkerIds: string[];
  setRenameTargetWorkerIds: Dispatch<SetStateAction<string[]>>;
  killConfirmWorkerIds: string[];
  setKillConfirmWorkerIds: Dispatch<SetStateAction<string[]>>;
  setRenameDraft: Dispatch<SetStateAction<string>>;
}

interface UseWorkerActionUiStateResult {
  renameTargetWorkers: Worker[];
  killConfirmWorkers: Worker[];
  closeRenameModal: () => void;
  closeKillConfirm: () => void;
  openRenameForWorkers: (workersToRename: Worker[]) => void;
}

export function useWorkerActionUiState({
  workers,
  activeWorkers,
  renameModalOpen,
  setRenameModalOpen,
  renameTargetWorkerIds,
  setRenameTargetWorkerIds,
  killConfirmWorkerIds,
  setKillConfirmWorkerIds,
  setRenameDraft
}: UseWorkerActionUiStateParams): UseWorkerActionUiStateResult {
  const renameTargetWorkers = useMemo(() => {
    if (renameTargetWorkerIds.length === 0) {
      return [];
    }

    const workerById = new Map(workers.map((worker) => [worker.id, worker]));
    return renameTargetWorkerIds
      .map((workerId) => workerById.get(workerId))
      .filter((worker): worker is Worker => Boolean(worker));
  }, [renameTargetWorkerIds, workers]);

  const killConfirmWorkers = useMemo(() => {
    if (killConfirmWorkerIds.length === 0) {
      return [];
    }

    const workerById = new Map(workers.map((worker) => [worker.id, worker]));
    return killConfirmWorkerIds
      .map((workerId) => workerById.get(workerId))
      .filter((worker): worker is Worker => Boolean(worker));
  }, [killConfirmWorkerIds, workers]);

  const closeRenameModal = useCallback(() => {
    setRenameModalOpen(false);
    setRenameTargetWorkerIds([]);
  }, [setRenameModalOpen, setRenameTargetWorkerIds]);

  const closeKillConfirm = useCallback(() => {
    setKillConfirmWorkerIds([]);
  }, [setKillConfirmWorkerIds]);

  const openRenameForWorkers = useCallback(
    (workersToRename: Worker[]) => {
      if (workersToRename.length === 0) {
        return;
      }

      setRenameDraft(workersToRename.length === 1 ? workersToRename[0].displayName ?? workersToRename[0].name : "");
      setRenameTargetWorkerIds(workersToRename.map((worker) => worker.id));
      setRenameModalOpen(true);
    },
    [setRenameDraft, setRenameModalOpen, setRenameTargetWorkerIds]
  );

  useEffect(() => {
    if (!renameModalOpen || renameTargetWorkerIds.length === 0) {
      return;
    }

    const activeWorkerIdSet = new Set(activeWorkers.map((worker) => worker.id));
    if (!renameTargetWorkerIds.some((workerId) => activeWorkerIdSet.has(workerId))) {
      closeRenameModal();
    }
  }, [activeWorkers, closeRenameModal, renameModalOpen, renameTargetWorkerIds]);

  useEffect(() => {
    if (killConfirmWorkerIds.length === 0) {
      return;
    }

    const activeIds = new Set(activeWorkers.map((worker) => worker.id));
    if (!killConfirmWorkerIds.some((workerId) => activeIds.has(workerId))) {
      closeKillConfirm();
    }
  }, [activeWorkers, closeKillConfirm, killConfirmWorkerIds]);

  return {
    renameTargetWorkers,
    killConfirmWorkers,
    closeRenameModal,
    closeKillConfirm,
    openRenameForWorkers
  };
}
