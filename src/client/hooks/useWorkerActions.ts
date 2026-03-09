import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { Worker, WorkerSpawnInput } from "../../shared/types";
import type { RosterEntry } from "../app/types";
import { useWorkerActionUiState } from "./workerActions/useWorkerActionUiState";
import { useWorkerKillActions } from "./workerActions/useWorkerKillActions";
import { useWorkerMutationActions, type BatchSpawnItem } from "./workerActions/useWorkerMutationActions";
import { useWorkerRallyActions } from "./workerActions/useWorkerRallyActions";
import { useWorkerRestartActions } from "./workerActions/useWorkerRestartActions";

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
  setRenameDraft: Dispatch<SetStateAction<string>>;
  restartConfirmWorkerIds: string[];
  setRestartConfirmWorkerIds: Dispatch<SetStateAction<string[]>>;
  killConfirmWorkerIds: string[];
  setKillConfirmWorkerIds: Dispatch<SetStateAction<string[]>>;
  rallyCommandDraft: string;
  setRallyCommandDraft: Dispatch<SetStateAction<string>>;
  rallyCommandSending: boolean;
  setRallyCommandSending: Dispatch<SetStateAction<boolean>>;
  rallyCommandResultText: string | undefined;
  setRallyCommandResultText: Dispatch<SetStateAction<string | undefined>>;
  setRespawningWorkerIds: Dispatch<SetStateAction<string[]>>;
  queueWorkerFade: (worker: Worker) => void;
  removeWorkerFade: (workerId: string) => void;
  playArrivalVoiceLine: (worker: Worker) => void;
  setErrorText: Dispatch<SetStateAction<string | undefined>>;
}

interface UseWorkerActionsResult {
  renameTargetWorkers: Worker[];
  restartConfirmWorkers: Worker[];
  killConfirmWorkers: Worker[];
  runSpawn: (input: WorkerSpawnInput) => Promise<void>;
  runBatchSpawn: (items: BatchSpawnItem[], onProgress: (done: number, total: number) => void) => Promise<void>;
  closeRenameModal: () => void;
  closeRestartConfirm: () => void;
  closeKillConfirm: () => void;
  openRenameForWorkers: (workersToRename: Worker[]) => void;
  submitRename: (draft: string) => Promise<void>;
  onRestartSelected: () => void;
  onRestartRosterActive: () => void;
  confirmRestartSelection: () => void;
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
  setRenameDraft,
  restartConfirmWorkerIds,
  setRestartConfirmWorkerIds,
  killConfirmWorkerIds,
  setKillConfirmWorkerIds,
  rallyCommandDraft,
  setRallyCommandDraft,
  rallyCommandSending,
  setRallyCommandSending,
  rallyCommandResultText,
  setRallyCommandResultText,
  setRespawningWorkerIds,
  queueWorkerFade,
  removeWorkerFade,
  playArrivalVoiceLine,
  setErrorText
}: UseWorkerActionsParams): UseWorkerActionsResult {
  const showError = useCallback(
    (error: unknown) => {
      setErrorText(error instanceof Error ? error.message : "Unknown request failure");
    },
    [setErrorText]
  );

  const {
    renameTargetWorkers,
    restartConfirmWorkers,
    killConfirmWorkers,
    closeRenameModal,
    closeRestartConfirm,
    closeKillConfirm,
    openRenameForWorkers
  } =
    useWorkerActionUiState({
      workers,
      activeWorkers,
      renameModalOpen,
      setRenameModalOpen,
      renameTargetWorkerIds,
      setRenameTargetWorkerIds,
      restartConfirmWorkerIds,
      setRestartConfirmWorkerIds,
      killConfirmWorkerIds,
      setKillConfirmWorkerIds,
      setRenameDraft
    });

  const { runSpawn, runBatchSpawn, submitRename, onToggleMovementModeSelected, onOpenSelectedInTerminal, onPositionCommit } =
    useWorkerMutationActions({
      setWorkers,
      selectedWorkers,
      terminalWorkerId,
      applySelection,
      setSpawnDialogOpen,
      setPaletteOpen,
      renameTargetWorkerIds,
      closeRenameModal,
      showError
    });

  const { onRestartSelected, onRestartRosterActive, confirmRestartSelection } = useWorkerRestartActions({
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
  });

  const { onKillSelected, onKillRosterActive, confirmKillSelection } = useWorkerKillActions({
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
  });

  const { onSendRallyCommand, onRallyCommandDraftChange } = useWorkerRallyActions({
    selectedWorkers,
    rallyCommandDraft,
    setRallyCommandDraft,
    rallyCommandSending,
    setRallyCommandSending,
    rallyCommandResultText,
    setRallyCommandResultText,
    showError
  });

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

  const onRenameSelected = useCallback(() => {
    if (selectedWorkers.length === 0) {
      return;
    }

    const focusedGroupWorker =
      selectedWorkers.length > 1 ? selectedWorkers.find((worker) => worker.id === focusedSelectedWorkerId) : undefined;
    openRenameForWorkers(focusedGroupWorker ? [focusedGroupWorker] : selectedWorkers);
  }, [focusedSelectedWorkerId, openRenameForWorkers, selectedWorkers]);

  return {
    renameTargetWorkers,
    restartConfirmWorkers,
    killConfirmWorkers,
    runSpawn,
    runBatchSpawn,
    closeRenameModal,
    closeRestartConfirm,
    closeKillConfirm,
    openRenameForWorkers,
    submitRename,
    onRestartSelected,
    onRestartRosterActive,
    confirmRestartSelection,
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
