import { useCallback, useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import type { Worker, WorkerSpawnInput } from "../../shared/types";
import {
  broadcastWorkerInput,
  openWorkerInTerminal,
  renameWorker,
  setWorkerMovementMode,
  spawnWorker,
  stopWorker,
  updateWorkerPosition
} from "../api";
import type { RosterEntry } from "../app/types";
import { formatRallyCommandResult, mergeBroadcastInputResults, upsertWorker } from "../app/utils";

interface UseWorkerActionsParams {
  workers: Worker[];
  activeWorkers: Worker[];
  setWorkers: Dispatch<SetStateAction<Worker[]>>;
  selectedWorkers: Worker[];
  selectedWorkerIds: string[];
  setSelectedWorkerIds: Dispatch<SetStateAction<string[]>>;
  focusedSelectedWorkerId: string | undefined;
  terminalWorkerId: string | undefined;
  rosterEntries: RosterEntry[];
  rosterActiveIndex: number;
  setRosterActiveIndex: Dispatch<SetStateAction<number>>;
  applySelection: (workerIds: string[], options?: { center?: boolean; focusTerminal?: boolean }) => void;
  setSpawnDialogOpen: Dispatch<SetStateAction<boolean>>;
  setPaletteOpen: Dispatch<SetStateAction<boolean>>;
  renameModalOpen: boolean;
  setRenameModalOpen: Dispatch<SetStateAction<boolean>>;
  renameTargetWorkerIds: string[];
  setRenameTargetWorkerIds: Dispatch<SetStateAction<string[]>>;
  renameDraft: string;
  setRenameDraft: Dispatch<SetStateAction<string>>;
  killConfirmWorkerIds: string[];
  setKillConfirmWorkerIds: Dispatch<SetStateAction<string[]>>;
  rallyCommandDraft: string;
  setRallyCommandDraft: Dispatch<SetStateAction<string>>;
  rallyCommandSending: boolean;
  setRallyCommandSending: Dispatch<SetStateAction<boolean>>;
  rallyCommandResultText: string | undefined;
  setRallyCommandResultText: Dispatch<SetStateAction<string | undefined>>;
  queueWorkerFade: (worker: Worker) => void;
  removeWorkerFade: (workerId: string) => void;
  setErrorText: Dispatch<SetStateAction<string | undefined>>;
}

interface UseWorkerActionsResult {
  renameTargetWorkers: Worker[];
  killConfirmWorkers: Worker[];
  runSpawn: (input: WorkerSpawnInput) => Promise<void>;
  closeRenameModal: () => void;
  closeKillConfirm: () => void;
  openRenameForWorkers: (workersToRename: Worker[]) => void;
  submitRename: () => Promise<void>;
  onKillSelected: () => void;
  onKillRosterActive: () => void;
  confirmKillSelection: () => void;
  onToggleMovementModeSelected: () => Promise<void>;
  onActivateRosterIndex: (index: number) => void;
  onOpenSelectedInTerminal: () => Promise<void>;
  onSendRallyCommand: () => Promise<void>;
  onRallyCommandDraftChange: (value: string) => void;
  onRenameSelected: () => void;
  onPositionCommit: (workerId: string, position: { x: number; y: number }) => void;
}

export function useWorkerActions({
  workers,
  activeWorkers,
  setWorkers,
  selectedWorkers,
  selectedWorkerIds,
  setSelectedWorkerIds,
  focusedSelectedWorkerId,
  terminalWorkerId,
  rosterEntries,
  rosterActiveIndex,
  setRosterActiveIndex,
  applySelection,
  setSpawnDialogOpen,
  setPaletteOpen,
  renameModalOpen,
  setRenameModalOpen,
  renameTargetWorkerIds,
  setRenameTargetWorkerIds,
  renameDraft,
  setRenameDraft,
  killConfirmWorkerIds,
  setKillConfirmWorkerIds,
  rallyCommandDraft,
  setRallyCommandDraft,
  rallyCommandSending,
  setRallyCommandSending,
  rallyCommandResultText,
  setRallyCommandResultText,
  queueWorkerFade,
  removeWorkerFade,
  setErrorText
}: UseWorkerActionsParams): UseWorkerActionsResult {
  const showError = useCallback(
    (error: unknown) => {
      setErrorText(error instanceof Error ? error.message : "Unknown request failure");
    },
    [setErrorText]
  );

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

  const onActivateRosterIndex = useCallback(
    (index: number) => {
      const entry = rosterEntries[index];
      if (!entry) {
        return;
      }

      setRosterActiveIndex(index);

      if (entry.kind === "worker") {
        applySelection([entry.worker.id], { center: true });
        return;
      }

      void runSpawn({ shortcutIndex: entry.shortcutIndex });
    },
    [applySelection, rosterEntries, runSpawn, setRosterActiveIndex]
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

  const onSendRallyCommand = useCallback(async () => {
    if (rallyCommandSending) {
      return;
    }

    const workerIds = selectedWorkers.map((worker) => worker.id);
    if (workerIds.length <= 1) {
      return;
    }

    if (rallyCommandDraft.length === 0) {
      setRallyCommandResultText("Enter a command to broadcast.");
      return;
    }

    setRallyCommandSending(true);
    setRallyCommandResultText(undefined);

    try {
      const hasNameTemplate = rallyCommandDraft.includes("$NAME");
      const result = hasNameTemplate
        ? mergeBroadcastInputResults(
            await Promise.all(
              selectedWorkers.map(async (worker) => {
                const command = rallyCommandDraft.replace(/\$NAME/g, worker.displayName ?? worker.name);
                try {
                  return await broadcastWorkerInput([worker.id], command, true);
                } catch (error) {
                  return {
                    requestedCount: 1,
                    deliveredWorkerIds: [],
                    skippedWorkerIds: [],
                    failed: [
                      {
                        workerId: worker.id,
                        error: error instanceof Error ? error.message : "Failed to send input"
                      }
                    ]
                  };
                }
              })
            )
          )
        : await broadcastWorkerInput(workerIds, rallyCommandDraft, true);

      setRallyCommandDraft("");
      setRallyCommandResultText(formatRallyCommandResult(result));
    } catch (error) {
      showError(error);
    } finally {
      setRallyCommandSending(false);
    }
  }, [rallyCommandDraft, rallyCommandSending, selectedWorkers, setRallyCommandDraft, setRallyCommandResultText, setRallyCommandSending, showError]);

  const onRallyCommandDraftChange = useCallback(
    (value: string) => {
      setRallyCommandDraft(value);
      if (rallyCommandResultText) {
        setRallyCommandResultText(undefined);
      }
    },
    [rallyCommandResultText, setRallyCommandDraft, setRallyCommandResultText]
  );

  const onRenameSelected = useCallback(() => {
    if (selectedWorkers.length === 0) {
      return;
    }

    const focusedGroupWorker =
      selectedWorkers.length > 1 ? selectedWorkers.find((worker) => worker.id === focusedSelectedWorkerId) : undefined;
    openRenameForWorkers(focusedGroupWorker ? [focusedGroupWorker] : selectedWorkers);
  }, [focusedSelectedWorkerId, openRenameForWorkers, selectedWorkers]);

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
    renameTargetWorkers,
    killConfirmWorkers,
    runSpawn,
    closeRenameModal,
    closeKillConfirm,
    openRenameForWorkers,
    submitRename,
    onKillSelected,
    onKillRosterActive,
    confirmKillSelection,
    onToggleMovementModeSelected,
    onActivateRosterIndex,
    onOpenSelectedInTerminal,
    onSendRallyCommand,
    onRallyCommandDraftChange,
    onRenameSelected,
    onPositionCommit
  };
}
