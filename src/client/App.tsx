import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  killFadeDurationMs,
  mapColumnRatioStep,
  maxMapColumnRatio,
  minMapColumnRatio,
  splitPaneDividerWidthPx
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
import { BatchSpawnDialog } from "./components/BatchSpawnDialog";
import { CommandPalette } from "./components/CommandPalette";
import { KillConfirmDialog } from "./components/KillConfirmDialog";
import { MapCanvas } from "./components/MapCanvas";
import { RenameDialog } from "./components/RenameDialog";
import { RestartConfirmDialog } from "./components/RestartConfirmDialog";
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
import { useWorkerVoiceLines } from "./hooks/useWorkerVoiceLines";
import { useWorkerActions } from "./hooks/useWorkerActions";
import { buildShortcutHotkeyBindings, findMatchingShortcutIndexes } from "./hotkeys/shortcutHotkeys";

export default function App(): JSX.Element {
  const [spawnDialogOpen, setSpawnDialogOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [batchSpawnDialogOpen, setBatchSpawnDialogOpen] = useState(false);
  const [shortcutsOverlayOpen, setShortcutsOverlayOpen] = useState(false);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [restartConfirmWorkerIds, setRestartConfirmWorkerIds] = useState<string[]>([]);
  const [killConfirmWorkerIds, setKillConfirmWorkerIds] = useState<string[]>([]);
  const [respawningWorkerIds, setRespawningWorkerIds] = useState<string[]>([]);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameTargetWorkerIds, setRenameTargetWorkerIds] = useState<string[]>([]);
  const [rallyCommandDraft, setRallyCommandDraft] = useState("");
  const [rallyCommandSending, setRallyCommandSending] = useState(false);
  const [rallyCommandResultText, setRallyCommandResultText] = useState<string | undefined>(undefined);
  const [errorText, setErrorText] = useState<string | undefined>(undefined);
  const [scatterMoveOrders, setScatterMoveOrders] = useState<Array<{ workerId: string; target: { x: number; y: number } }>>([]);
  const [scatterMoveToken, setScatterMoveToken] = useState(0);
  const rallyCommandInputRef = useRef<HTMLTextAreaElement | null>(null);

  const { config, workers, setWorkers, workersHydrated } = useArcaneAgentsData(setErrorText);
  const { fadingWorkers, queueWorkerFade, removeWorkerFade } = useWorkerFade(killFadeDurationMs);

  const activeWorkers = useMemo(
    () => workers.filter((worker) => worker.status !== "stopped" && !respawningWorkerIds.includes(worker.id)),
    [respawningWorkerIds, workers]
  );
  const voiceLineWorkers = useMemo(() => workers.filter((worker) => worker.status !== "stopped"), [workers]);

  useEffect(() => {
    const workerIdSet = new Set(workers.map((worker) => worker.id));
    setRespawningWorkerIds((current) => current.filter((workerId) => workerIdSet.has(workerId)));
  }, [workers]);

  const {
    controlGroups,
    setControlGroups,
    controlGroupByDigitRef,
    mapColumnRatio,
    setMapColumnRatio,
    nudgeMapColumnRatio,
    resetMapColumnRatio
  } = useLayoutAndControlGroups(activeWorkers, workersHydrated);

  const appShellRef = useRef<HTMLDivElement | null>(null);
  const splitDividerPointerIdRef = useRef<number | undefined>(undefined);
  const [splitDividerDragging, setSplitDividerDragging] = useState(false);

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

  const { playArrivalVoiceLine, playMoveVoiceLine } = useWorkerVoiceLines({
    config,
    workers: voiceLineWorkers,
    workersHydrated,
    selectedWorkerIds
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

  const onScatterSelected = useCallback(() => {
    if (selectedWorkers.length < 2) {
      return;
    }

    const cx = selectedWorkers.reduce((sum, w) => sum + w.position.x, 0) / selectedWorkers.length;
    const cy = selectedWorkers.reduce((sum, w) => sum + w.position.y, 0) / selectedWorkers.length;
    const spread = 80 + selectedWorkers.length * 20;

    const orders = selectedWorkers.map((worker) => ({
      workerId: worker.id,
      target: {
        x: cx + (Math.random() - 0.5) * spread * 2,
        y: cy + (Math.random() - 0.5) * spread * 2
      }
    }));

    setScatterMoveOrders(orders);
    setScatterMoveToken((t) => t + 1);
  }, [selectedWorkers]);

  const updateMapColumnRatioFromPointer = useCallback(
    (clientX: number) => {
      const shell = appShellRef.current;
      if (!shell) {
        return;
      }

      const bounds = shell.getBoundingClientRect();
      const availableWidth = Math.max(1, bounds.width - splitPaneDividerWidthPx);
      const pointerOffsetX = clientX - bounds.left - splitPaneDividerWidthPx / 2;
      const nextRatio = clampNumber(pointerOffsetX / availableWidth, minMapColumnRatio, maxMapColumnRatio);
      setMapColumnRatio(nextRatio);
    },
    [setMapColumnRatio]
  );

  useEffect(() => {
    if (!splitDividerDragging) {
      return;
    }

    document.body.classList.add("split-pane-dragging");
    return () => {
      document.body.classList.remove("split-pane-dragging");
    };
  }, [splitDividerDragging]);

  const {
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
  });

  useAppHotkeys({
    activeWorkers,
    applySelection,
    batchSpawnDialogOpen,
    clampNumber,
    closeKillConfirm,
    closeRestartConfirm,
    closeRenameModal,
    confirmKillSelection,
    confirmRestartSelection,
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
    restartConfirmWorkerIds,
    mapColumnRatioStep,
    nudgeMapColumnRatio,
    onActivateRosterIndex,
    onKillRosterActive,
    onKillSelected,
    onRestartRosterActive,
    onRestartSelected,
    onScatterSelected,
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
    setBatchSpawnDialogOpen,
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

  const appShellStyle = useMemo(
    () =>
      ({
        "--map-column-width": `${mapColumnRatio.toFixed(3)}fr`,
        "--terminal-column-width": `${(1 - mapColumnRatio).toFixed(3)}fr`,
        "--layout-divider-width": `${splitPaneDividerWidthPx}px`
      }) as CSSProperties,
    [mapColumnRatio]
  );

  return (
    <div ref={appShellRef} className="app-shell" style={appShellStyle}>
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
          onMoveOrderIssued={playMoveVoiceLine}
          onPositionCommit={onPositionCommit}
          externalMoveOrders={scatterMoveOrders}
          externalMoveOrderToken={scatterMoveToken}
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
          onRestartSelected={() => {
            onRestartSelected();
          }}
          onKillSelected={() => {
            onKillSelected();
          }}
          onRenameSelected={() => {
            onRenameSelected();
          }}
          onToggleMovementMode={() => {
            void onToggleMovementModeSelected();
          }}
          onScatterSelected={() => {
            void onScatterSelected();
          }}
        />
      </div>

      <div
        className={`layout-divider${splitDividerDragging ? " layout-divider-active" : ""}`}
        role="separator"
        aria-label="Resize map and terminal columns"
        aria-orientation="vertical"
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }

          event.preventDefault();
          splitDividerPointerIdRef.current = event.pointerId;
          setSplitDividerDragging(true);
          event.currentTarget.setPointerCapture(event.pointerId);
          updateMapColumnRatioFromPointer(event.clientX);
        }}
        onPointerMove={(event) => {
          if (splitDividerPointerIdRef.current !== event.pointerId) {
            return;
          }

          event.preventDefault();
          updateMapColumnRatioFromPointer(event.clientX);
        }}
        onPointerUp={(event) => {
          if (splitDividerPointerIdRef.current !== event.pointerId) {
            return;
          }

          event.preventDefault();
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          splitDividerPointerIdRef.current = undefined;
          setSplitDividerDragging(false);
        }}
        onPointerCancel={(event) => {
          if (splitDividerPointerIdRef.current !== event.pointerId) {
            return;
          }

          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          splitDividerPointerIdRef.current = undefined;
          setSplitDividerDragging(false);
        }}
      />

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
          onOpenBatchSpawn={() => {
            setPaletteOpen(false);
            setBatchSpawnDialogOpen(true);
          }}
        />
      ) : null}

      {config ? (
        <BatchSpawnDialog
          open={batchSpawnDialogOpen}
          config={config}
          onClose={() => setBatchSpawnDialogOpen(false)}
          onBatchSpawn={runBatchSpawn}
        />
      ) : null}

      <ShortcutsDialog
        open={shortcutsOverlayOpen}
        onClose={() => {
          setShortcutsOverlayOpen(false);
        }}
      />

      <RestartConfirmDialog
        workerIds={restartConfirmWorkerIds}
        workers={restartConfirmWorkers}
        onClose={closeRestartConfirm}
        onConfirm={confirmRestartSelection}
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
