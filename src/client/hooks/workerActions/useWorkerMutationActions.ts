import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { Worker, WorkerSpawnInput } from "../../../shared/types";
import {
  openWorkerInTerminal,
  renameWorker,
  setWorkerMovementMode,
  spawnWorker,
  updateWorkerPosition
} from "../../api";
import { upsertWorker } from "../../app/utils";

interface UseWorkerMutationActionsParams {
  setWorkers: Dispatch<SetStateAction<Worker[]>>;
  selectedWorkers: Worker[];
  terminalWorkerId: string | undefined;
  applySelection: (workerIds: string[], options?: { center?: boolean; focusTerminal?: boolean }) => void;
  setSpawnDialogOpen: Dispatch<SetStateAction<boolean>>;
  setPaletteOpen: Dispatch<SetStateAction<boolean>>;
  renameTargetWorkerIds: string[];
  renameDraft: string;
  closeRenameModal: () => void;
  showError: (error: unknown) => void;
}

interface UseWorkerMutationActionsResult {
  runSpawn: (input: WorkerSpawnInput) => Promise<void>;
  submitRename: () => Promise<void>;
  onToggleMovementModeSelected: () => Promise<void>;
  onOpenSelectedInTerminal: () => Promise<void>;
  onPositionCommit: (workerId: string, position: { x: number; y: number }) => void;
}

export function useWorkerMutationActions({
  setWorkers,
  selectedWorkers,
  terminalWorkerId,
  applySelection,
  setSpawnDialogOpen,
  setPaletteOpen,
  renameTargetWorkerIds,
  renameDraft,
  closeRenameModal,
  showError
}: UseWorkerMutationActionsParams): UseWorkerMutationActionsResult {
  const runSpawn = useCallback(
    async (input: WorkerSpawnInput) => {
      try {
        const worker = await spawnWorker(input);
        setWorkers((currentWorkers) => upsertWorker(currentWorkers, worker));
        applySelection([worker.id], { center: true });
        setSpawnDialogOpen(false);
        setPaletteOpen(false);
      } catch (error) {
        showError(error);
      }
    },
    [applySelection, setPaletteOpen, setSpawnDialogOpen, setWorkers, showError]
  );

  const submitRename = useCallback(async () => {
    const targetWorkerIds = [...renameTargetWorkerIds];
    if (targetWorkerIds.length === 0) {
      closeRenameModal();
      return;
    }

    try {
      if (targetWorkerIds.length === 1) {
        const worker = await renameWorker(targetWorkerIds[0], renameDraft);
        setWorkers((currentWorkers) => upsertWorker(currentWorkers, worker));
      } else {
        const baseName = renameDraft.trim();
        const renamedWorkers = await Promise.all(
          targetWorkerIds.map((workerId, index) => renameWorker(workerId, baseName.length > 0 ? `${baseName} ${index + 1}` : ""))
        );
        setWorkers((currentWorkers) => {
          let nextWorkers = currentWorkers;
          for (const worker of renamedWorkers) {
            nextWorkers = upsertWorker(nextWorkers, worker);
          }
          return nextWorkers;
        });
      }

      closeRenameModal();
    } catch (error) {
      showError(error);
    }
  }, [closeRenameModal, renameDraft, renameTargetWorkerIds, setWorkers, showError]);

  const onToggleMovementModeSelected = useCallback(async () => {
    if (selectedWorkers.length === 0) {
      return;
    }

    const nextMode = selectedWorkers.every((worker) => worker.movementMode === "hold") ? "wander" : "hold";

    try {
      const updatedWorkers = await Promise.all(selectedWorkers.map((worker) => setWorkerMovementMode(worker.id, nextMode)));
      setWorkers((currentWorkers) => {
        let nextWorkers = currentWorkers;
        for (const worker of updatedWorkers) {
          nextWorkers = upsertWorker(nextWorkers, worker);
        }
        return nextWorkers;
      });
    } catch (error) {
      showError(error);
    }
  }, [selectedWorkers, setWorkers, showError]);

  const onOpenSelectedInTerminal = useCallback(async () => {
    if (!terminalWorkerId) {
      return;
    }

    try {
      await openWorkerInTerminal(terminalWorkerId);
    } catch (error) {
      showError(error);
    }
  }, [showError, terminalWorkerId]);

  const onPositionCommit = useCallback(
    (workerId: string, position: { x: number; y: number }) => {
      void updateWorkerPosition(workerId, position.x, position.y)
        .then((worker) => {
          setWorkers((currentWorkers) => upsertWorker(currentWorkers, worker));
        })
        .catch((error) => {
          showError(error);
        });
    },
    [setWorkers, showError]
  );

  return {
    runSpawn,
    submitRename,
    onToggleMovementModeSelected,
    onOpenSelectedInTerminal,
    onPositionCommit
  };
}
