import { useEffect, useRef } from "react";
import { isTerminalTarget } from "../app/utils";
import type { AppHotkeyDeps } from "../hotkeys/hotkeyContext";
import { runHotkeyRegistry, type HotkeyContext } from "../hotkeys/registry";
import { useAppStore } from "../state/appStore";
import {
  selectActiveWorkers,
  selectFirstSummonEntryIndex,
  selectInSelectedGroupView,
  selectRosterEntries,
  selectSelectedWorkerId,
  selectSelectedWorkers
} from "../state/selectors";

// Single window keydown listener. On each key it snapshots the store (state + store
// actions) and merges App's injected callbacks into the registry context, then walks
// the registry. Reading the store live at event time removes the mirror-ref the old
// context needed.
export function useAppHotkeys(deps: AppHotkeyDeps): void {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const context = buildHotkeyContext(depsRef.current);
      if (shouldBypassHotkeyRoutingForTerminalInput(event, context)) {
        return;
      }
      runHotkeyRegistry(event, context);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}

function buildHotkeyContext(deps: AppHotkeyDeps): HotkeyContext {
  const state = useAppStore.getState();
  return {
    activeWorkers: selectActiveWorkers(state),
    selectedWorkerId: selectSelectedWorkerId(state),
    selectedWorkerIds: state.selectedWorkerIds,
    selectedWorkers: selectSelectedWorkers(state),
    focusedSelectedWorkerId: state.focusedSelectedWorkerId,
    inSelectedGroupView: selectInSelectedGroupView(state),
    rosterEntries: selectRosterEntries(state),
    rosterActiveIndex: state.rosterActiveIndex,
    selectedGroupActiveIndex: state.selectedGroupActiveIndex,
    firstSummonEntryIndex: selectFirstSummonEntryIndex(state),
    controlGroups: state.controlGroups,
    pendingConfirm: state.pendingConfirm,
    openDialog: state.openDialog,
    shortcutHotkeyBindings: deps.shortcutHotkeyBindings,

    applySelection: state.applySelection,
    cycleSelection: state.cycleSelection,
    cycleIdleSelection: state.cycleIdleSelection,
    cycleReviewSelection: (direction) =>
      state.cycleReviewSelection(direction, deps.pendingCompletionWorkerIds),
    cycleSelectedGroupFocus: state.cycleSelectedGroupFocus,
    setControlGroups: state.setControlGroups,
    setRosterActiveIndex: state.setRosterActiveIndex,
    setSelectedGroupActiveIndex: state.setSelectedGroupActiveIndex,
    setFocusedSelectedWorkerId: state.setFocusedSelectedWorkerId,
    requestTerminalFocus: state.requestTerminalFocus,
    clearConfirm: state.clearConfirm,
    closeRename: state.closeRename,
    setBatchSpawnDialogOpen: state.setBatchSpawnDialogOpen,
    setShortcutsOverlayOpen: state.setShortcutsOverlayOpen,
    setPaletteOpen: state.setPaletteOpen,
    setSpawnDialogOpen: state.setSpawnDialogOpen,
    nudgeMapColumnRatio: state.nudgeMapColumnRatio,
    resetMapColumnRatio: state.resetMapColumnRatio,

    confirmPending: deps.confirmPending,
    onKillSelected: deps.onKillSelected,
    onKillRosterActive: deps.onKillRosterActive,
    onRestartSelected: deps.onRestartSelected,
    onRestartRosterActive: deps.onRestartRosterActive,
    onRenameSelected: deps.onRenameSelected,
    onToggleMovementModeSelected: deps.onToggleMovementModeSelected,
    onActivateRosterIndex: deps.onActivateRosterIndex,
    onScatterSelected: deps.onScatterSelected,
    runSpawn: deps.runSpawn,
    focusRallyCommandInput: deps.focusRallyCommandInput,
    escapeTerminalFocus: deps.escapeTerminalFocus,
    isTerminalEscapeShortcut: deps.isTerminalEscapeShortcut
  };
}

function shouldBypassHotkeyRoutingForTerminalInput(event: KeyboardEvent, context: HotkeyContext): boolean {
  if (!isTerminalTarget(event.target)) {
    return false;
  }

  if (context.pendingConfirm !== null || context.openDialog !== null) {
    return false;
  }

  if (event.key === "Escape" || context.isTerminalEscapeShortcut(event)) {
    return false;
  }

  return true;
}
