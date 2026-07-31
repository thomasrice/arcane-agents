import { useCallback, useEffect, useMemo, useRef, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { killFadeDurationMs, splitPaneDividerWidthPx } from "./app/constants";
import type { RosterEntry } from "./app/types";
import { AppDialogs } from "./components/AppDialogs";
import { MapColumn } from "./components/MapColumn";
import type { MapCanvasHandle } from "./components/MapCanvas";
import type { RallyCommandHandle } from "./components/RallyCommandCard";
import { SplitDivider } from "./components/SplitDivider";
import { TerminalColumn } from "./components/TerminalColumn";
import type { TerminalPanelHandle } from "./components/TerminalPanel";
import { useAppHotkeys } from "./hooks/useAppHotkeys";
import { useServerSync } from "./hooks/useServerSync";
import { useSplitDivider } from "./hooks/useSplitDivider";
import { useStoreReconciliation } from "./hooks/useStoreReconciliation";
import { useTerminalFocus } from "./hooks/useTerminalFocus";
import { useWorkerActions } from "./hooks/useWorkerActions";
import { useWorkerCompletionNotifications } from "./hooks/useWorkerCompletionNotifications";
import { useWorkerFade } from "./hooks/useWorkerFade";
import { useWorkerVoiceLines } from "./hooks/useWorkerVoiceLines";
import { buildShortcutHotkeyBindings, matchesShortcutHotkey, parseHotkeys } from "./hotkeys/shortcutHotkeys";
import { useAppStore } from "./state/appStore";
import { setMapCommandTarget, setTerminalCommandTarget } from "./state/imperativeBridge";
import { selectActiveWorkers, selectSelectedWorkers, selectTerminalWorker, selectVoiceLineWorkers } from "./state/selectors";

export default function App(): JSX.Element {
  useServerSync();

  const config = useAppStore((state) => state.config);
  const workersHydrated = useAppStore((state) => state.workersHydrated);
  const activeWorkers = useAppStore(useShallow(selectActiveWorkers));
  const voiceLineWorkers = useAppStore(useShallow(selectVoiceLineWorkers));
  const selectedWorkerIds = useAppStore(useShallow((state) => state.selectedWorkerIds));
  const selectedWorkers = useAppStore(useShallow(selectSelectedWorkers));
  const terminalWorker = useAppStore(selectTerminalWorker);
  const rosterActiveIndex = useAppStore((state) => state.rosterActiveIndex);
  const selectedGroupActiveIndex = useAppStore((state) => state.selectedGroupActiveIndex);
  const mapColumnRatio = useAppStore((state) => state.mapColumnRatio);
  const audioVolume = useAppStore((state) => state.audioVolume);
  const syncReviewSession = useAppStore((state) => state.syncReviewSession);

  const terminalActions = useAppStore(
    useShallow((state) => ({
      setRosterActiveIndex: state.setRosterActiveIndex,
      setSelectedGroupActiveIndex: state.setSelectedGroupActiveIndex,
      setFocusedSelectedWorkerId: state.setFocusedSelectedWorkerId
    }))
  );

  const mapRef = useRef<MapCanvasHandle>(null);
  const terminalPanelRef = useRef<TerminalPanelHandle>(null);
  const rallyCardRef = useRef<RallyCommandHandle>(null);

  // Register the live component handles so store actions can drive imperative
  // map/terminal commands through the bridge (replaces the center/focus token state).
  useEffect(() => {
    setMapCommandTarget({ centerOnWorkers: (workerIds) => mapRef.current?.centerOnWorkers(workerIds) });
    setTerminalCommandTarget({ focus: () => terminalPanelRef.current?.focus() });
    return () => {
      setMapCommandTarget(null);
      setTerminalCommandTarget(null);
    };
  }, []);

  const { fadingWorkers, queueWorkerFade, removeWorkerFade } = useWorkerFade(killFadeDurationMs);

  const { playArrivalVoiceLine, playMoveVoiceLine } = useWorkerVoiceLines({
    config,
    audioVolume,
    workers: voiceLineWorkers,
    workersHydrated,
    selectedWorkerIds
  });

  const workerActions = useWorkerActions({ queueWorkerFade, removeWorkerFade, playArrivalVoiceLine });

  useStoreReconciliation();

  const terminalWorkerId = terminalWorker?.id;
  const terminalFocused = useTerminalFocus(terminalWorkerId);

  const { pendingCompletionWorkerIds } = useWorkerCompletionNotifications({
    workers: activeWorkers,
    reviewedWorkerId: terminalWorkerId
  });

  useEffect(() => {
    syncReviewSession(pendingCompletionWorkerIds);
  }, [activeWorkers, pendingCompletionWorkerIds, syncReviewSession]);

  const summonShortcuts = useMemo(() => config?.shortcuts ?? [], [config]);
  const shortcutHotkeyBindings = useMemo(() => buildShortcutHotkeyBindings(summonShortcuts), [summonShortcuts]);
  const rosterEntries = useMemo<RosterEntry[]>(
    () => [
      ...activeWorkers.map((worker) => ({ kind: "worker", worker }) as const),
      ...summonShortcuts.map((shortcut, shortcutIndex) => ({ kind: "shortcut", shortcut, shortcutIndex }) as const)
    ],
    [activeWorkers, summonShortcuts]
  );

  const terminalEscapeHotkeys = useMemo(
    () => parseHotkeys(config?.keybindings.leaveTerminalFocus ?? []),
    [config?.keybindings.leaveTerminalFocus]
  );
  const isTerminalEscapeShortcut = useCallback(
    (event: KeyboardEvent) => terminalEscapeHotkeys.some((hotkey) => matchesShortcutHotkey(hotkey, event)),
    [terminalEscapeHotkeys]
  );

  const escapeTerminalFocus = useCallback((): boolean => {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement) || !activeElement.closest(".terminal-panel")) {
      return false;
    }

    activeElement.blur();
    mapRef.current?.focus();
    return true;
  }, []);

  const focusRallyCommandInput = useCallback((): boolean => rallyCardRef.current?.focus() ?? false, []);

  const scatterSelected = useCallback((): void => {
    const workerIds = selectSelectedWorkers(useAppStore.getState()).map((worker) => worker.id);
    if (workerIds.length < 2) {
      return;
    }
    mapRef.current?.scatterWorkers(workerIds);
  }, []);

  const { appShellRef, dragging: splitDividerDragging, dividerHandlers } = useSplitDivider();

  useAppHotkeys({
    pendingCompletionWorkerIds,
    shortcutHotkeyBindings,
    confirmPending: workerActions.confirmPending,
    onKillSelected: workerActions.onKillSelected,
    onKillRosterActive: workerActions.onKillRosterActive,
    onRestartSelected: workerActions.onRestartSelected,
    onRestartRosterActive: workerActions.onRestartRosterActive,
    onRenameSelected: workerActions.onRenameSelected,
    onToggleMovementModeSelected: workerActions.onToggleMovementModeSelected,
    onActivateRosterIndex: workerActions.onActivateRosterIndex,
    onScatterSelected: scatterSelected,
    runSpawn: workerActions.runSpawn,
    focusRallyCommandInput,
    escapeTerminalFocus,
    isTerminalEscapeShortcut
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
      <MapColumn
        mapRef={mapRef}
        workerActions={workerActions}
        fadingWorkers={fadingWorkers}
        completionPendingWorkerIds={pendingCompletionWorkerIds}
        terminalFocused={terminalFocused}
        terminalWorkerId={terminalWorkerId}
        onMoveOrderIssued={playMoveVoiceLine}
        onScatterSelected={scatterSelected}
      />

      <SplitDivider dragging={splitDividerDragging} handlers={dividerHandlers} />

      <TerminalColumn
        activeWorkers={activeWorkers}
        selectedWorkers={selectedWorkers}
        terminalWorker={terminalWorker}
        terminalFocused={terminalFocused}
        selectedGroupActiveIndex={selectedGroupActiveIndex}
        setSelectedGroupActiveIndex={terminalActions.setSelectedGroupActiveIndex}
        setFocusedSelectedWorkerId={terminalActions.setFocusedSelectedWorkerId}
        rallyCardRef={rallyCardRef}
        rosterEntries={rosterEntries}
        completionPendingWorkerIds={pendingCompletionWorkerIds}
        rosterActiveIndex={rosterActiveIndex}
        setRosterActiveIndex={terminalActions.setRosterActiveIndex}
        onActivateRosterIndex={workerActions.onActivateRosterIndex}
        onOpenSelectedInTerminal={workerActions.onOpenSelectedInTerminal}
        terminalPanelRef={terminalPanelRef}
      />

      <AppDialogs workerActions={workerActions} />
    </div>
  );
}
