import { useCallback, useMemo, useRef, useState } from "react";
import {
  killFadeDurationMs,
  mapColumnRatioStep
} from "./app/constants";
import type { RosterEntry } from "./app/types";
import {
  clampNumber,
  isEditableTarget,
  isTerminalEscapeShortcut,
  isTerminalTarget,
  parseControlGroupDigit
} from "./app/utils";
import { BottomBar } from "./components/BottomBar";
import { CommandPalette } from "./components/CommandPalette";
import { KillConfirmDialog } from "./components/KillConfirmDialog";
import { MapCanvas } from "./components/MapCanvas";
import { RenameDialog } from "./components/RenameDialog";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { SpawnDialog } from "./components/SpawnDialog";
import { TerminalColumn } from "./components/TerminalColumn";
import { useAppHotkeys } from "./hooks/useAppHotkeys";
import { useArcaneAgentsData } from "./hooks/useArcaneAgentsData";
import { useLayoutAndControlGroups } from "./hooks/useLayoutAndControlGroups";
import { useSelectionModel } from "./hooks/useSelectionModel";
import { useTerminalFocus } from "./hooks/useTerminalFocus";
import { useWorkerCompletionNotifications } from "./hooks/useWorkerCompletionNotifications";
import { useWorkerFade } from "./hooks/useWorkerFade";
import { useWorkerActions } from "./hooks/useWorkerActions";
import { buildShortcutHotkeyBindings, findMatchingShortcutIndexes } from "./hotkeys/shortcutHotkeys";

export default function App(): JSX.Element {
  const [spawnDialogOpen, setSpawnDialogOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOverlayOpen, setShortcutsOverlayOpen] = useState(false);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [killConfirmWorkerIds, setKillConfirmWorkerIds] = useState<string[]>([]);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameTargetWorkerIds, setRenameTargetWorkerIds] = useState<string[]>([]);
  const [rallyCommandDraft, setRallyCommandDraft] = useState("");
  const [rallyCommandSending, setRallyCommandSending] = useState(false);
  const [rallyCommandResultText, setRallyCommandResultText] = useState<string | undefined>(undefined);
  const [errorText, setErrorText] = useState<string | undefined>(undefined);
  const rallyCommandInputRef = useRef<HTMLTextAreaElement | null>(null);

  const { config, workers, setWorkers, workersHydrated } = useArcaneAgentsData(setErrorText);
  const { fadingWorkers, queueWorkerFade, removeWorkerFade } = useWorkerFade(killFadeDurationMs);

  const activeWorkers = useMemo(() => workers.filter((worker) => worker.status !== "stopped"), [workers]);

  const {
    controlGroups,
    setControlGroups,
    controlGroupByDigitRef,
    mapColumnRatio,
    nudgeMapColumnRatio,
    resetMapColumnRatio
  } = useLayoutAndControlGroups(activeWorkers, workersHydrated);

  const summonShortcuts = useMemo(() => config?.shortcuts ?? [], [config]);
  const shortcutHotkeyBindings = useMemo(() => buildShortcutHotkeyBindings(summonShortcuts), [summonShortcuts]);

  const rosterEntries = useMemo<RosterEntry[]>(
    () => [
      ...activeWorkers.map((worker) => ({ kind: "worker", worker }) as const),
      ...summonShortcuts.map((shortcut, shortcutIndex) => ({ kind: "shortcut", shortcut, shortcutIndex }) as const)
    ],
    [activeWorkers, summonShortcuts]
  );

  const firstSummonEntryIndex = useMemo(() => {
    const firstIndex = rosterEntries.findIndex((entry) => entry.kind === "shortcut");
    return firstIndex >= 0 ? firstIndex : undefined;
  }, [rosterEntries]);

  const clearSelectedGroupCommandState = useCallback(() => {
    setRallyCommandDraft("");
    setRallyCommandResultText(undefined);
  }, []);

  const {
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
  } = useSelectionModel(activeWorkers, rosterEntries, clearSelectedGroupCommandState);

  const selectedWorker = useMemo(
    () => activeWorkers.find((worker) => worker.id === selectedWorkerId),
    [activeWorkers, selectedWorkerId]
  );

  const focusedSelectedWorker = useMemo(() => {
    if (!focusedSelectedWorkerId) {
      return undefined;
    }

    return selectedWorkers.find((worker) => worker.id === focusedSelectedWorkerId);
  }, [focusedSelectedWorkerId, selectedWorkers]);

  const terminalWorker = selectedWorker ?? (selectedWorkers.length > 1 ? focusedSelectedWorker : undefined);
  const terminalWorkerId = terminalWorker?.id;
  const inSelectedGroupView = selectedWorkers.length > 1 && !terminalWorker;
  const terminalFocused = useTerminalFocus(terminalWorkerId);

  const { pendingCompletionWorkerIds } = useWorkerCompletionNotifications({
    workers: activeWorkers,
    reviewedWorkerId: terminalWorkerId
  });

  const escapeTerminalFocus = useCallback((): boolean => {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) {
      return false;
    }

    if (!activeElement.closest(".terminal-panel")) {
      return false;
    }

    activeElement.blur();
    const mapCanvas = document.querySelector<HTMLCanvasElement>(".map-canvas");
    mapCanvas?.focus();
    return true;
  }, []);

  const focusRallyCommandInput = useCallback((): boolean => {
    const input = rallyCommandInputRef.current;
    if (!input) {
      return false;
    }

    input.focus();
    const cursor = input.value.length;
    input.setSelectionRange(cursor, cursor);
    return true;
  }, []);

  const {
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
  } = useWorkerActions({
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
  });

  useAppHotkeys({
    activeWorkers,
    applySelection,
    clampNumber,
    closeKillConfirm,
    closeRenameModal,
    confirmKillSelection,
    controlGroupByDigitRef,
    cycleIdleSelection,
    cycleSelectedGroupFocus,
    cycleSelection,
    escapeTerminalFocus,
    findMatchingShortcutIndexes,
    firstSummonEntryIndex,
    focusRallyCommandInput,
    focusedSelectedWorkerId,
    inSelectedGroupView,
    isEditableTarget,
    isTerminalEscapeShortcut,
    isTerminalTarget,
    killConfirmWorkerIds,
    mapColumnRatioStep,
    nudgeMapColumnRatio,
    onActivateRosterIndex,
    onKillRosterActive,
    onKillSelected,
    onToggleMovementModeSelected,
    openRenameForWorkers,
    paletteOpen,
    parseControlGroupDigit,
    renameModalOpen,
    requestTerminalFocus,
    resetMapColumnRatio,
    rosterActiveIndex,
    rosterEntries,
    runSpawn,
    selectedGroupActiveIndex,
    selectedWorkerId,
    selectedWorkerIds,
    selectedWorkers,
    setControlGroups,
    setFocusedSelectedWorkerId,
    setPaletteOpen,
    setRosterActiveIndex,
    setSelectedGroupActiveIndex,
    setShortcutsOverlayOpen,
    setSpawnDialogOpen,
    shortcutHotkeyBindings,
    shortcutsOverlayOpen,
    spawnDialogOpen
  });

  return (
    <div
      className="app-shell"
      style={{
        gridTemplateColumns: `minmax(380px, ${mapColumnRatio.toFixed(3)}fr) minmax(360px, ${(1 - mapColumnRatio).toFixed(3)}fr)`
      }}
    >
      <div className="map-column">
        <MapCanvas
          workers={activeWorkers}
          fadingWorkers={fadingWorkers}
          selectedWorkerId={selectedWorkerId}
          selectedWorkerIds={selectedWorkerIds}
          focusedSelectedWorkerId={focusedSelectedWorkerId}
          terminalFocusedSelected={Boolean(selectedWorkerId && terminalFocused)}
          terminalFocusedWorkerId={terminalFocused ? terminalWorkerId : undefined}
          controlGroups={controlGroups}
          completionPendingWorkerIds={pendingCompletionWorkerIds}
          onSelect={onSelectWorker}
          onSelectionChange={onSelectionChange}
          onActivateWorker={onActivateWorker}
          onPositionCommit={onPositionCommit}
          centerOnWorkerId={mapCenterWorkerId}
          centerRequestKey={mapCenterToken}
        />
        <BottomBar
          shortcuts={config?.shortcuts ?? []}
          selectedWorker={selectedWorker}
          selectedWorkers={selectedWorkers}
          onSpawnShortcut={(shortcutIndex) => {
            void runSpawn({ shortcutIndex });
          }}
          onOpenSpawnDialog={() => {
            setSpawnDialogOpen(true);
            setPaletteOpen(false);
          }}
          onOpenPalette={() => {
            setPaletteOpen(true);
            setSpawnDialogOpen(false);
          }}
          onDeselect={() => onSelectWorker(undefined)}
          onKillSelected={() => {
            onKillSelected();
          }}
          onRenameSelected={() => {
            onRenameSelected();
          }}
          onToggleMovementMode={() => {
            void onToggleMovementModeSelected();
          }}
        />
      </div>

      <TerminalColumn
        activeWorkers={activeWorkers}
        selectedWorkers={selectedWorkers}
        terminalWorker={terminalWorker}
        terminalFocused={terminalFocused}
        selectedGroupActiveIndex={selectedGroupActiveIndex}
        setSelectedGroupActiveIndex={setSelectedGroupActiveIndex}
        setFocusedSelectedWorkerId={setFocusedSelectedWorkerId}
        rallyCommandInputRef={rallyCommandInputRef}
        rallyCommandDraft={rallyCommandDraft}
        rallyCommandSending={rallyCommandSending}
        rallyCommandResultText={rallyCommandResultText}
        onRallyCommandDraftChange={onRallyCommandDraftChange}
        onSendRallyCommand={onSendRallyCommand}
        rosterEntries={rosterEntries}
        completionPendingWorkerIds={pendingCompletionWorkerIds}
        rosterActiveIndex={rosterActiveIndex}
        setRosterActiveIndex={setRosterActiveIndex}
        onActivateRosterIndex={onActivateRosterIndex}
        onOpenSelectedInTerminal={onOpenSelectedInTerminal}
        terminalFocusToken={terminalFocusToken}
      />

      {config ? (
        <SpawnDialog
          open={spawnDialogOpen}
          projects={config.projects}
          runtimes={config.runtimes}
          onClose={() => setSpawnDialogOpen(false)}
          onSpawn={(projectId, runtimeId) => {
            void runSpawn({ projectId, runtimeId });
          }}
        />
      ) : null}

      {config ? (
        <CommandPalette
          open={paletteOpen}
          config={config}
          onClose={() => setPaletteOpen(false)}
          onSpawnShortcut={(shortcutIndex) => {
            void runSpawn({ shortcutIndex });
          }}
          onSpawnProjectRuntime={(projectId, runtimeId) => {
            void runSpawn({ projectId, runtimeId });
          }}
        />
      ) : null}

      <ShortcutsDialog
        open={shortcutsOverlayOpen}
        onClose={() => {
          setShortcutsOverlayOpen(false);
        }}
      />

      <KillConfirmDialog
        workerIds={killConfirmWorkerIds}
        workers={killConfirmWorkers}
        onClose={closeKillConfirm}
        onConfirm={confirmKillSelection}
      />

      <RenameDialog
        open={renameModalOpen}
        targetWorkerIds={renameTargetWorkerIds}
        targetWorkers={renameTargetWorkers}
        initialDraft={renameDraft}
        onClose={closeRenameModal}
        onSubmit={submitRename}
      />

      {errorText ? (
        <div className="error-toast" onClick={() => setErrorText(undefined)}>
          {errorText}
        </div>
      ) : null}
    </div>
  );
}
