import { useCallback } from "react";
import type { Worker, WorkerSpawnInput } from "../../shared/types";
import type { BatchSpawnItem } from "../app/types";
import {
  openWorkerInTerminal,
  renameWorker,
  restartWorker,
  setWorkerMovementMode,
  setWorkerSilenced,
  spawnWorker,
  stopWorker,
  updateWorkerPosition
} from "../api";
import { useAppStore } from "../state/appStore";
import { selectRosterEntries, selectSelectedWorkers, selectTerminalWorker } from "../state/selectors";

interface UseWorkerActionsParams {
  queueWorkerFade: (worker: Worker) => void;
  removeWorkerFade: (workerId: string) => void;
  playArrivalVoiceLine: (worker: Worker) => void;
}

export interface UseWorkerActionsResult {
  runSpawn: (input: WorkerSpawnInput) => Promise<void>;
  runBatchSpawn: (items: BatchSpawnItem[], onProgress: (done: number, total: number) => void) => Promise<void>;
  submitRename: (draft: string) => Promise<void>;
  onRenameSelected: () => void;
  onToggleMovementModeSelected: () => Promise<void>;
  onToggleSilencedSelected: () => Promise<void>;
  onActivateRosterIndex: (index: number) => void;
  onOpenSelectedInTerminal: () => Promise<void>;
  onPositionCommit: (workerId: string, position: { x: number; y: number }) => void;
  onKillSelected: () => void;
  onKillRosterActive: () => void;
  onRestartSelected: () => void;
  onRestartRosterActive: () => void;
  confirmPending: () => void;
}

export function getNextSelectedSilencedState(selectedWorkers: readonly Pick<Worker, "silenced">[]): boolean {
  return !selectedWorkers.every((worker) => worker.silenced);
}

// Owns the spawn / rename / movement / kill / restart / rally flows. Unlike the
// former 34-parameter conduit, every piece of shared state lives in the store —
// the only external inputs are the fade controller and arrival voice line, which
// are owned by sibling hooks outside the store.
export function useWorkerActions({
  queueWorkerFade,
  removeWorkerFade,
  playArrivalVoiceLine
}: UseWorkerActionsParams): UseWorkerActionsResult {
  const showError = useCallback((error: unknown) => {
    useAppStore.getState().setErrorText(error instanceof Error ? error.message : "Unknown request failure");
  }, []);

  const runSpawn = useCallback(
    async (input: WorkerSpawnInput) => {
      try {
        const selectedWorkerIds = selectSelectedWorkers(useAppStore.getState()).map((worker) => worker.id);
        const spawnInput: WorkerSpawnInput =
          "shortcutIndex" in input && selectedWorkerIds.length > 0
            ? { ...input, spawnNearWorkerIds: selectedWorkerIds }
            : input;

        const worker = await spawnWorker(spawnInput);
        const store = useAppStore.getState();
        store.upsertWorker(worker);
        store.applySelection([worker.id], { center: true });
        store.setSpawnDialogOpen(false);
        store.setPaletteOpen(false);
      } catch (error) {
        showError(error);
      }
    },
    [showError]
  );

  const runBatchSpawn = useCallback(
    async (items: BatchSpawnItem[], onProgress: (done: number, total: number) => void) => {
      const initialSelectedIds = selectSelectedWorkers(useAppStore.getState()).map((worker) => worker.id);
      const spawnedWorkerIds: string[] = [];
      let lastWorkerId: string | undefined;

      for (let index = 0; index < items.length; index++) {
        onProgress(index, items.length);
        const item = items[index];
        const spawnInput: WorkerSpawnInput = {
          ...item.input,
          displayName: item.displayName,
          spawnNearWorkerIds: lastWorkerId ? [lastWorkerId] : initialSelectedIds.slice(0, 1)
        };

        try {
          const worker = await spawnWorker(spawnInput);
          useAppStore.getState().upsertWorker(worker);
          spawnedWorkerIds.push(worker.id);
          lastWorkerId = worker.id;
        } catch (error) {
          showError(error);
          break;
        }
      }

      onProgress(spawnedWorkerIds.length, items.length);

      if (spawnedWorkerIds.length > 0) {
        useAppStore.getState().applySelection(spawnedWorkerIds, { center: true });
      }
    },
    [showError]
  );

  const submitRename = useCallback(
    async (draft: string) => {
      const store = useAppStore.getState();
      const targetWorkerIds = [...store.renameTargetWorkerIds];
      if (targetWorkerIds.length === 0) {
        store.closeRename();
        return;
      }

      try {
        if (targetWorkerIds.length === 1) {
          const worker = await renameWorker(targetWorkerIds[0], draft);
          useAppStore.getState().upsertWorker(worker);
        } else {
          const baseName = draft.trim();
          const renamedWorkers = await Promise.all(
            targetWorkerIds.map((workerId, index) =>
              renameWorker(workerId, baseName.length > 0 ? `${baseName} ${index + 1}` : "")
            )
          );
          const state = useAppStore.getState();
          for (const worker of renamedWorkers) {
            state.upsertWorker(worker);
          }
        }

        useAppStore.getState().closeRename();
      } catch (error) {
        showError(error);
      }
    },
    [showError]
  );

  const onRenameSelected = useCallback(() => {
    const state = useAppStore.getState();
    const selectedWorkers = selectSelectedWorkers(state);
    if (selectedWorkers.length === 0) {
      return;
    }

    const focusedGroupWorker =
      selectedWorkers.length > 1
        ? selectedWorkers.find((worker) => worker.id === state.focusedSelectedWorkerId)
        : undefined;
    state.openRenameForWorkers(focusedGroupWorker ? [focusedGroupWorker] : selectedWorkers);
  }, []);

  const onToggleMovementModeSelected = useCallback(async () => {
    const selectedWorkers = selectSelectedWorkers(useAppStore.getState());
    if (selectedWorkers.length === 0) {
      return;
    }

    const nextMode = selectedWorkers.every((worker) => worker.movementMode === "hold") ? "wander" : "hold";

    try {
      const updatedWorkers = await Promise.all(
        selectedWorkers.map((worker) => setWorkerMovementMode(worker.id, nextMode))
      );
      const state = useAppStore.getState();
      for (const worker of updatedWorkers) {
        state.upsertWorker(worker);
      }
    } catch (error) {
      showError(error);
    }
  }, [showError]);

  const onToggleSilencedSelected = useCallback(async () => {
    const selectedWorkers = selectSelectedWorkers(useAppStore.getState());
    if (selectedWorkers.length === 0) {
      return;
    }

    const nextSilenced = getNextSelectedSilencedState(selectedWorkers);

    try {
      const updatedWorkers = await Promise.all(
        selectedWorkers
          .filter((worker) => worker.silenced !== nextSilenced)
          .map((worker) => setWorkerSilenced(worker.id, nextSilenced))
      );
      const state = useAppStore.getState();
      for (const worker of updatedWorkers) {
        state.upsertWorker(worker);
      }
    } catch (error) {
      showError(error);
    }
  }, [showError]);

  const onOpenSelectedInTerminal = useCallback(async () => {
    const terminalWorker = selectTerminalWorker(useAppStore.getState());
    if (!terminalWorker) {
      return;
    }

    try {
      await openWorkerInTerminal(terminalWorker.id);
    } catch (error) {
      showError(error);
    }
  }, [showError]);

  const onPositionCommit = useCallback(
    (workerId: string, position: { x: number; y: number }) => {
      void updateWorkerPosition(workerId, position.x, position.y)
        .then((worker) => {
          useAppStore.getState().upsertWorker(worker);
        })
        .catch((error) => {
          showError(error);
        });
    },
    [showError]
  );

  const onKillWorker = useCallback(
    async (workerId: string) => {
      const worker = useAppStore.getState().workers.find((item) => item.id === workerId);
      if (!worker) {
        return;
      }

      queueWorkerFade(worker);

      try {
        const result = await stopWorker(workerId);
        const state = useAppStore.getState();
        state.removeWorker(result.workerId);
        state.setSelectedWorkerIds((current) => current.filter((currentWorkerId) => currentWorkerId !== result.workerId));
      } catch (error) {
        removeWorkerFade(workerId);
        showError(error);
      }
    },
    [queueWorkerFade, removeWorkerFade, showError]
  );

  const onRestartWorker = useCallback(
    async (workerId: string) => {
      const store = useAppStore.getState();
      const worker = store.workers.find((item) => item.id === workerId);
      if (!worker) {
        return;
      }

      queueWorkerFade(worker);
      store.setRespawningWorkerIds((current) => (current.includes(workerId) ? current : [...current, workerId]));

      try {
        const updatedWorker = await restartWorker(workerId);
        const respawnedWorker: Worker = {
          ...updatedWorker,
          createdAt: new Date().toISOString()
        };
        const state = useAppStore.getState();
        state.upsertWorker(respawnedWorker);
        state.setRespawningWorkerIds((current) => current.filter((currentWorkerId) => currentWorkerId !== workerId));
        state.applySelection([respawnedWorker.id], { center: true });
        playArrivalVoiceLine(respawnedWorker);
      } catch (error) {
        removeWorkerFade(workerId);
        useAppStore
          .getState()
          .setRespawningWorkerIds((current) => current.filter((currentWorkerId) => currentWorkerId !== workerId));
        showError(error);
      }
    },
    [playArrivalVoiceLine, queueWorkerFade, removeWorkerFade, showError]
  );

  const onActivateRosterIndex = useCallback(
    (index: number) => {
      const state = useAppStore.getState();
      const entry = selectRosterEntries(state)[index];
      if (!entry) {
        return;
      }

      state.setRosterActiveIndex(index);

      if (entry.kind === "worker") {
        state.applySelection([entry.worker.id], { center: true });
        return;
      }

      void runSpawn({ shortcutIndex: entry.shortcutIndex });
    },
    [runSpawn]
  );

  const onKillSelected = useCallback(() => {
    const state = useAppStore.getState();
    if (state.selectedWorkerIds.length === 0) {
      return;
    }

    state.requestConfirm("kill", state.selectedWorkerIds);
  }, []);

  const onKillRosterActive = useCallback(() => {
    const state = useAppStore.getState();
    const entry = selectRosterEntries(state)[state.rosterActiveIndex];
    if (!entry || entry.kind !== "worker") {
      return;
    }

    state.requestConfirm("kill", [entry.worker.id]);
  }, []);

  const onRestartSelected = useCallback(() => {
    const state = useAppStore.getState();
    if (state.selectedWorkerIds.length === 0) {
      return;
    }

    state.requestConfirm("restart", state.selectedWorkerIds);
  }, []);

  const onRestartRosterActive = useCallback(() => {
    const state = useAppStore.getState();
    const entry = selectRosterEntries(state)[state.rosterActiveIndex];
    if (!entry || entry.kind !== "worker") {
      return;
    }

    state.requestConfirm("restart", [entry.worker.id]);
  }, []);

  // Single confirm handler for both kill and restart: read the pending atom,
  // close it, then dispatch the per-worker action for its kind.
  const confirmPending = useCallback(() => {
    const state = useAppStore.getState();
    const pending = state.pendingConfirm;
    if (!pending || pending.workerIds.length === 0) {
      return;
    }

    const workerIds = [...pending.workerIds];
    const performOne = pending.kind === "kill" ? onKillWorker : onRestartWorker;
    state.clearConfirm();
    for (const workerId of workerIds) {
      void performOne(workerId);
    }
  }, [onKillWorker, onRestartWorker]);

  return {
    runSpawn,
    runBatchSpawn,
    submitRename,
    onRenameSelected,
    onToggleMovementModeSelected,
    onToggleSilencedSelected,
    onActivateRosterIndex,
    onOpenSelectedInTerminal,
    onPositionCommit,
    onKillSelected,
    onKillRosterActive,
    onRestartSelected,
    onRestartRosterActive,
    confirmPending
  };
}
