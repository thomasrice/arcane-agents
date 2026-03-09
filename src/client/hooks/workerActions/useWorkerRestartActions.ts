import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { Worker } from "../../../shared/types";
import { restartWorker } from "../../api";
import type { RosterEntry } from "../../app/types";

interface UseWorkerRestartActionsParams {
  workers: Worker[];
  selectedWorkerIds: string[];
  rosterEntries: RosterEntry[];
  rosterActiveIndex: number;
  applySelection: (workerIds: string[], options?: { center?: boolean; focusTerminal?: boolean }) => void;
  setRestartConfirmWorkerIds: Dispatch<SetStateAction<string[]>>;
  closeRestartConfirm: () => void;
  restartConfirmWorkerIds: string[];
  setRespawningWorkerIds: Dispatch<SetStateAction<string[]>>;
  queueWorkerFade: (worker: Worker) => void;
  removeWorkerFade: (workerId: string) => void;
  setWorkers: Dispatch<SetStateAction<Worker[]>>;
  playArrivalVoiceLine: (worker: Worker) => void;
  showError: (error: unknown) => void;
}

interface UseWorkerRestartActionsResult {
  onRestartSelected: () => void;
  onRestartRosterActive: () => void;
  confirmRestartSelection: () => void;
}

export function useWorkerRestartActions({
  workers,
  selectedWorkerIds,
  rosterEntries,
  rosterActiveIndex,
  applySelection,
  setRestartConfirmWorkerIds,
  closeRestartConfirm,
  restartConfirmWorkerIds,
  setRespawningWorkerIds,
  queueWorkerFade,
  removeWorkerFade,
  setWorkers,
  playArrivalVoiceLine,
  showError
}: UseWorkerRestartActionsParams): UseWorkerRestartActionsResult {
  const onRestartWorker = useCallback(
    async (workerId: string) => {
      const worker = workers.find((item) => item.id === workerId);
      if (!worker) {
        return;
      }

      queueWorkerFade(worker);
      setRespawningWorkerIds((current) => (current.includes(workerId) ? current : [...current, workerId]));

      try {
        const updatedWorker = await restartWorker(workerId);
        const respawnedWorker: Worker = {
          ...updatedWorker,
          createdAt: new Date().toISOString()
        };
        setWorkers((currentWorkers) =>
          currentWorkers.map((currentWorker) => (currentWorker.id === respawnedWorker.id ? respawnedWorker : currentWorker))
        );
        setRespawningWorkerIds((current) => current.filter((currentWorkerId) => currentWorkerId !== workerId));
        applySelection([respawnedWorker.id], { center: true });
        playArrivalVoiceLine(respawnedWorker);
      } catch (error) {
        removeWorkerFade(workerId);
        setRespawningWorkerIds((current) => current.filter((currentWorkerId) => currentWorkerId !== workerId));
        showError(error);
      }
    },
    [applySelection, playArrivalVoiceLine, queueWorkerFade, removeWorkerFade, setRespawningWorkerIds, setWorkers, showError, workers]
  );

  const onRestartSelected = useCallback(() => {
    if (selectedWorkerIds.length === 0) {
      return;
    }

    setRestartConfirmWorkerIds(selectedWorkerIds);
  }, [selectedWorkerIds, setRestartConfirmWorkerIds]);

  const onRestartRosterActive = useCallback(() => {
    const entry = rosterEntries[rosterActiveIndex];
    if (!entry || entry.kind !== "worker") {
      return;
    }

    setRestartConfirmWorkerIds([entry.worker.id]);
  }, [rosterActiveIndex, rosterEntries, setRestartConfirmWorkerIds]);

  const confirmRestartSelection = useCallback(() => {
    if (restartConfirmWorkerIds.length === 0) {
      return;
    }

    const workerIds = [...restartConfirmWorkerIds];
    closeRestartConfirm();
    for (const workerId of workerIds) {
      void onRestartWorker(workerId);
    }
  }, [closeRestartConfirm, onRestartWorker, restartConfirmWorkerIds]);

  return {
    onRestartSelected,
    onRestartRosterActive,
    confirmRestartSelection
  };
}
