import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { Worker, WorkerSpawnInput } from "../../shared/types";
import type { RosterEntry } from "../app/types";
import { useWorkerActionUiState } from "./workerActions/useWorkerActionUiState";
import { useWorkerKillActions } from "./workerActions/useWorkerKillActions";
import { useWorkerMutationActions } from "./workerActions/useWorkerMutationActions";
import { useWorkerRallyActions } from "./workerActions/useWorkerRallyActions";

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

  const { renameTargetWorkers, killConfirmWorkers, closeRenameModal, closeKillConfirm, openRenameForWorkers } =
    useWorkerActionUiState({
      workers,
      activeWorkers,
      renameModalOpen,
      setRenameModalOpen,
      renameTargetWorkerIds,
      setRenameTargetWorkerIds,
      killConfirmWorkerIds,
      setKillConfirmWorkerIds,
      setRenameDraft
    });

  const { runSpawn, submitRename, onToggleMovementModeSelected, onOpenSelectedInTerminal, onPositionCommit } =
    useWorkerMutationActions({
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
