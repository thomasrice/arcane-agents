import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { Worker } from "../../../shared/types";
import { stopWorker } from "../../api";
import type { RosterEntry } from "../../app/types";

interface UseWorkerKillActionsParams {
  workers: Worker[];
  selectedWorkerIds: string[];
  setSelectedWorkerIds: Dispatch<SetStateAction<string[]>>;
  rosterEntries: RosterEntry[];
  rosterActiveIndex: number;
  setKillConfirmWorkerIds: Dispatch<SetStateAction<string[]>>;
  closeKillConfirm: () => void;
  killConfirmWorkerIds: string[];
  queueWorkerFade: (worker: Worker) => void;
  removeWorkerFade: (workerId: string) => void;
  setWorkers: Dispatch<SetStateAction<Worker[]>>;
  showError: (error: unknown) => void;
}

interface UseWorkerKillActionsResult {
  onKillSelected: () => void;
  onKillRosterActive: () => void;
  confirmKillSelection: () => void;
}

export function useWorkerKillActions({
  workers,
  selectedWorkerIds,
  setSelectedWorkerIds,
  rosterEntries,
  rosterActiveIndex,
  setKillConfirmWorkerIds,
  closeKillConfirm,
  killConfirmWorkerIds,
  queueWorkerFade,
  removeWorkerFade,
  setWorkers,
  showError
}: UseWorkerKillActionsParams): UseWorkerKillActionsResult {
  const onKillWorker = useCallback(
    async (workerId: string) => {
      const worker = workers.find((item) => item.id === workerId);
      if (!worker) {
        return;
      }

      closeKillConfirm();
      queueWorkerFade(worker);

      try {
        const result = await stopWorker(workerId);
        setWorkers((currentWorkers) => currentWorkers.filter((item) => item.id !== result.workerId));
        setSelectedWorkerIds((current) => current.filter((currentWorkerId) => currentWorkerId !== result.workerId));
      } catch (error) {
        removeWorkerFade(workerId);
        showError(error);
      }
    },
    [closeKillConfirm, queueWorkerFade, removeWorkerFade, setSelectedWorkerIds, setWorkers, showError, workers]
  );

  const onKillSelected = useCallback(() => {
    if (selectedWorkerIds.length === 0) {
      return;
    }

    setKillConfirmWorkerIds(selectedWorkerIds);
  }, [selectedWorkerIds, setKillConfirmWorkerIds]);

  const onKillRosterActive = useCallback(() => {
    const entry = rosterEntries[rosterActiveIndex];
    if (!entry || entry.kind !== "worker") {
      return;
    }

    setKillConfirmWorkerIds([entry.worker.id]);
  }, [rosterActiveIndex, rosterEntries, setKillConfirmWorkerIds]);

  const confirmKillSelection = useCallback(() => {
    if (killConfirmWorkerIds.length === 0) {
      return;
    }

    const workerIds = [...killConfirmWorkerIds];
    closeKillConfirm();
    for (const workerId of workerIds) {
      void onKillWorker(workerId);
    }
  }, [closeKillConfirm, killConfirmWorkerIds, onKillWorker]);

  return {
    onKillSelected,
    onKillRosterActive,
    confirmKillSelection
  };
}
