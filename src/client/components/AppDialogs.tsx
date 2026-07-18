import { useShallow } from "zustand/react/shallow";
import type { UseWorkerActionsResult } from "../hooks/useWorkerActions";
import { useAppStore } from "../state/appStore";
import { selectConfirmWorkers, selectRenameTargetWorkers } from "../state/selectors";
import { BatchSpawnDialog } from "./BatchSpawnDialog";
import { CommandPalette } from "./CommandPalette";
import { ConfirmDialog } from "./ConfirmDialog";
import { RenameDialog } from "./RenameDialog";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { SpawnDialog } from "./SpawnDialog";

interface AppDialogsProps {
  workerActions: UseWorkerActionsResult;
}

// The modal overlay stack (spawn / palette / batch / shortcuts / confirm / rename) plus
// the error toast. Every input except the worker-action mutation callbacks is read
// straight from the store, keeping App a layout-only composition root.
export function AppDialogs({ workerActions }: AppDialogsProps): JSX.Element {
  const config = useAppStore((state) => state.config);
  const openDialog = useAppStore((state) => state.openDialog);
  const pendingConfirm = useAppStore((state) => state.pendingConfirm);
  const confirmWorkers = useAppStore(useShallow(selectConfirmWorkers));
  const renameTargetWorkerIds = useAppStore(useShallow((state) => state.renameTargetWorkerIds));
  const renameTargetWorkers = useAppStore(useShallow(selectRenameTargetWorkers));
  const renameDraft = useAppStore((state) => state.renameDraft);
  const errorText = useAppStore((state) => state.errorText);

  const actions = useAppStore(
    useShallow((state) => ({
      setSpawnDialogOpen: state.setSpawnDialogOpen,
      setPaletteOpen: state.setPaletteOpen,
      setBatchSpawnDialogOpen: state.setBatchSpawnDialogOpen,
      setShortcutsOverlayOpen: state.setShortcutsOverlayOpen,
      closeRename: state.closeRename,
      clearConfirm: state.clearConfirm,
      setErrorText: state.setErrorText
    }))
  );

  return (
    <>
      {config ? (
        <SpawnDialog
          open={openDialog === "spawn"}
          projects={config.projects}
          runtimes={config.runtimes}
          onClose={() => actions.setSpawnDialogOpen(false)}
          onSpawn={(projectId, runtimeId) => {
            void workerActions.runSpawn({ projectId, runtimeId });
          }}
        />
      ) : null}

      {config ? (
        <CommandPalette
          open={openDialog === "palette"}
          config={config}
          onClose={() => actions.setPaletteOpen(false)}
          onSpawnShortcut={(shortcutIndex) => {
            void workerActions.runSpawn({ shortcutIndex });
          }}
          onSpawnProjectRuntime={(projectId, runtimeId) => {
            void workerActions.runSpawn({ projectId, runtimeId });
          }}
          onOpenBatchSpawn={() => actions.setBatchSpawnDialogOpen(true)}
        />
      ) : null}

      {config ? (
        <BatchSpawnDialog
          open={openDialog === "batchSpawn"}
          config={config}
          onClose={() => actions.setBatchSpawnDialogOpen(false)}
          onBatchSpawn={workerActions.runBatchSpawn}
        />
      ) : null}

      <ShortcutsDialog
        open={openDialog === "shortcuts"}
        leaveTerminalFocusHotkeys={config?.keybindings.leaveTerminalFocus ?? []}
        onClose={() => actions.setShortcutsOverlayOpen(false)}
      />

      <ConfirmDialog
        pendingConfirm={pendingConfirm}
        workers={confirmWorkers}
        onConfirm={workerActions.confirmPending}
        onClose={actions.clearConfirm}
      />

      <RenameDialog
        open={openDialog === "rename"}
        targetWorkerIds={renameTargetWorkerIds}
        targetWorkers={renameTargetWorkers}
        initialDraft={renameDraft}
        onClose={actions.closeRename}
        onSubmit={workerActions.submitRename}
      />

      {errorText ? (
        <div className="error-toast" onClick={() => actions.setErrorText(undefined)}>
          {errorText}
        </div>
      ) : null}
    </>
  );
}
